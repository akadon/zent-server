import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import * as messageService from "../../services/message.service.js";
import * as reactionService from "../../services/reaction.service.js";
import * as channelService from "../../services/channel.service.js";
import * as readStateService from "../../services/readstate.service.js";
import * as fileService from "../../services/file.service.js";
import * as messageComponentService from "../../services/message-component.service.js";
import * as notificationService from "../../services/notification.service.js";
import { ApiError } from "../../services/auth.service.js";
import * as permissionService from "../../services/permission.service.js";
import { PermissionFlags } from "@yxc/permissions";
import { redisPub } from "../../config/redis.js";
import { db, schema } from "../../db/index.js";
import { eq, inArray } from "drizzle-orm";
import { generateSnowflake } from "@yxc/snowflake";

// Schema for message components
const componentSchema: z.ZodType<messageComponentService.ComponentData> = z.lazy(() =>
  z.object({
    type: z.number().int().min(1).max(8),
    customId: z.string().max(100).optional(),
    label: z.string().max(80).optional(),
    style: z.number().int().min(1).max(6).optional(),
    url: z.string().url().optional(),
    disabled: z.boolean().optional(),
    emoji: z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      animated: z.boolean().optional(),
    }).optional(),
    options: z.array(z.object({
      label: z.string().max(100),
      value: z.string().max(100),
      description: z.string().max(100).optional(),
      emoji: z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        animated: z.boolean().optional(),
      }).optional(),
      default: z.boolean().optional(),
    })).max(25).optional(),
    placeholder: z.string().max(150).optional(),
    minValues: z.number().int().min(0).max(25).optional(),
    maxValues: z.number().int().min(1).max(25).optional(),
    minLength: z.number().int().min(0).max(4000).optional(),
    maxLength: z.number().int().min(1).max(4000).optional(),
    required: z.boolean().optional(),
    components: z.array(z.lazy(() => componentSchema)).max(5).optional(),
  })
);

async function dispatchMessage(channelId: string, event: string, data: unknown) {
  const channel = await channelService.getChannel(channelId);
  if (!channel) return;

  if (channel.guildId) {
    // Guild channel — dispatch to the guild room
    await redisPub.publish(
      `gateway:guild:${channel.guildId}`,
      JSON.stringify({ event, data })
    );
  } else {
    // DM channel — dispatch to each participant
    const participants = await db
      .select({ userId: schema.dmChannels.userId })
      .from(schema.dmChannels)
      .where(eq(schema.dmChannels.channelId, channelId));

    for (const p of participants) {
      await redisPub.publish(
        `gateway:user:${p.userId}`,
        JSON.stringify({ event, data })
      );
    }
  }
}

export async function messageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // Get channel messages (paginated)
  app.get("/channels/:channelId/messages", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const channel = await channelService.getChannel(channelId);
    if (!channel) throw new ApiError(404, "Channel not found");
    if (channel.guildId) {
      const { isMember } = await import("../../services/guild.service.js");
      if (!(await isMember(request.userId, channel.guildId))) {
        throw new ApiError(403, "Not a member of this guild");
      }
    }
    const query = z
      .object({
        before: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);

    const messages = await messageService.getChannelMessages(channelId, query, request.userId);
    return reply.send(messages);
  });

  // Create message
  app.post(
    "/channels/:channelId/messages",
    { preHandler: [createRateLimiter("messageCreate")] },
    async (request, reply) => {
      const { channelId } = request.params as { channelId: string };
      const body = z
        .object({
          content: z.string().max(4000).optional().default(""),
          tts: z.boolean().optional(),
          nonce: z.string().optional(),
          messageReference: z
            .object({ messageId: z.string() })
            .optional(),
          components: z.array(componentSchema).max(5).optional(),
          embeds: z.array(z.any()).max(10).optional(),
        })
        .parse(request.body);

      // Require content, components, or embeds
      if (!body.content && !body.components?.length && !body.embeds?.length) {
        throw new ApiError(400, "Message must have content, components, or embeds");
      }

      const message = await messageService.createMessage(
        channelId,
        request.userId,
        body.content,
        {
          tts: body.tts,
          nonce: body.nonce,
          referencedMessageId: body.messageReference?.messageId,
        }
      );

      if (!message) {
        throw new ApiError(500, "Failed to create message");
      }

      // Add components if provided
      if (body.components && body.components.length > 0) {
        await messageComponentService.createMessageComponents(message.id, body.components);
      }

      // Fetch the complete message with components
      const fullMessage = await messageService.getMessageWithAuthor(message.id);
      if (fullMessage && body.components?.length) {
        (fullMessage as any).components = await messageComponentService.getMessageComponents(message.id);
      }

      await dispatchMessage(channelId, "MESSAGE_CREATE", fullMessage ?? message);

      // Send notifications for mentioned users
      const mentionRegex = /<@(\d+)>/g;
      let match: RegExpExecArray | null;
      while ((match = mentionRegex.exec(body.content)) !== null) {
        const mentionedUserId = match[1]!;
        if (mentionedUserId !== request.userId) {
          const channel = await channelService.getChannel(channelId);
          notificationService.createNotification(mentionedUserId, "mention", "You were mentioned", {
            body: body.content.slice(0, 200),
            sourceGuildId: channel?.guildId ?? undefined,
            sourceChannelId: channelId,
            sourceMessageId: message.id,
            sourceUserId: request.userId,
          }).catch(() => {}); // fire and forget
        }
      }

      return reply.status(201).send(fullMessage ?? message);
    }
  );

  // Create message with file attachments (multipart)
  app.post(
    "/channels/:channelId/messages/upload",
    { preHandler: [createRateLimiter("messageCreate")] },
    async (request, reply) => {
      const { channelId } = request.params as { channelId: string };

      const parts = request.parts();
      let content = "";
      let tts = false;
      let nonce: string | undefined;
      let referencedMessageId: string | undefined;
      const attachments: Array<{
        id: string;
        filename: string;
        size: number;
        url: string;
        proxyUrl: string;
        contentType: string;
      }> = [];

      for await (const part of parts) {
        if (part.type === "field") {
          const value = part.value as string;
          switch (part.fieldname) {
            case "content":
              content = value;
              break;
            case "tts":
              tts = value === "true";
              break;
            case "nonce":
              nonce = value;
              break;
            case "message_reference":
              try {
                const ref = JSON.parse(value);
                referencedMessageId = ref.messageId;
              } catch {}
              break;
          }
        } else if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          const uploaded = await fileService.uploadFile(
            buffer,
            part.filename,
            part.mimetype,
            channelId
          );
          attachments.push(uploaded);
        }
      }

      if (!content && attachments.length === 0) {
        throw new ApiError(400, "Message must have content or attachments");
      }

      const message = await messageService.createMessage(
        channelId,
        request.userId,
        content || "",
        { tts, nonce, referencedMessageId }
      );

      // Save attachment records to DB
      if (message && attachments.length > 0) {
        for (const att of attachments) {
          await db.insert(schema.messageAttachments).values({
            id: att.id,
            messageId: message.id,
            filename: att.filename,
            size: att.size,
            url: att.url,
            proxyUrl: att.proxyUrl,
            contentType: att.contentType,
          });
        }
        const full = await messageService.getMessageWithAuthor(message.id);
        await dispatchMessage(channelId, "MESSAGE_CREATE", full);
        return reply.status(201).send(full);
      }

      await dispatchMessage(channelId, "MESSAGE_CREATE", message);
      return reply.status(201).send(message);
    }
  );

  // Edit message
  app.patch("/channels/:channelId/messages/:messageId", async (request, reply) => {
    const { channelId, messageId } = request.params as {
      channelId: string;
      messageId: string;
    };
    const body = z
      .object({
        content: z.string().max(4000).optional(),
        components: z.array(componentSchema).max(5).optional(),
        embeds: z.array(z.any()).max(10).optional(),
      })
      .parse(request.body);

    let message;
    if (body.content !== undefined) {
      message = await messageService.updateMessage(messageId, request.userId, body.content);
    } else {
      message = await messageService.getMessageWithAuthor(messageId);
    }

    // Update components if provided
    if (body.components !== undefined) {
      await messageComponentService.updateMessageComponents(messageId, body.components);
    }

    const components = await messageComponentService.getMessageComponents(messageId);

    await dispatchMessage(channelId, "MESSAGE_UPDATE", {
      id: messageId,
      channelId,
      content: body.content,
      components: components.length > 0 ? components : undefined,
      editedTimestamp: new Date().toISOString(),
    });

    return reply.send({ ...message, components: components.length > 0 ? components : undefined });
  });

  // Delete message
  app.delete(
    "/channels/:channelId/messages/:messageId",
    { preHandler: [createRateLimiter("messageDelete")] },
    async (request, reply) => {
      const { channelId, messageId } = request.params as {
        channelId: string;
        messageId: string;
      };
      const deleted = await messageService.deleteMessage(messageId, request.userId);

      const channel = await channelService.getChannel(channelId);
      await dispatchMessage(channelId, "MESSAGE_DELETE", {
        id: messageId,
        channelId,
        guildId: channel?.guildId ?? null,
      });

      return reply.status(204).send();
    }
  );

  // Bulk delete messages
  app.post(
    "/channels/:channelId/messages/bulk-delete",
    { preHandler: [createRateLimiter("messageDelete")] },
    async (request, reply) => {
      const { channelId } = request.params as { channelId: string };
      const body = z
        .object({
          messages: z.array(z.string()).min(2).max(100),
        })
        .parse(request.body);

      const channel = await channelService.getChannel(channelId);
      if (!channel) throw new ApiError(404, "Channel not found");
      if (!channel.guildId) throw new ApiError(400, "Bulk delete is only available in guild channels");

      await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_MESSAGES);

      await db
        .delete(schema.messages)
        .where(inArray(schema.messages.id, body.messages));

      await dispatchMessage(channelId, "MESSAGE_DELETE_BULK", {
        ids: body.messages,
        channelId,
        guildId: channel.guildId,
      });

      return reply.status(204).send();
    }
  );

  // ── Typing Indicator ──

  app.post(
    "/channels/:channelId/typing",
    { preHandler: [createRateLimiter("typing")] },
    async (request, reply) => {
      const { channelId } = request.params as { channelId: string };
      const channel = await channelService.getChannel(channelId);
      if (!channel) throw new ApiError(404, "Channel not found");

      await dispatchMessage(channelId, "TYPING_START", {
        channelId,
        guildId: channel.guildId ?? null,
        userId: request.userId,
        timestamp: Date.now(),
      });

      return reply.status(204).send();
    }
  );

  // ── Reactions ──

  app.put(
    "/channels/:channelId/messages/:messageId/reactions/:emoji/@me",
    { preHandler: [createRateLimiter("reaction")] },
    async (request, reply) => {
      const { channelId, messageId, emoji } = request.params as {
        channelId: string;
        messageId: string;
        emoji: string;
      };

      // emoji can be "name" for unicode or "name:id" for custom
      const [emojiName, emojiId] = emoji.includes(":") ? emoji.split(":") : [emoji, undefined];
      const result = await reactionService.addReaction(messageId, request.userId, emojiName!, emojiId);

      const channel = await channelService.getChannel(channelId);
      await dispatchMessage(channelId, "MESSAGE_REACTION_ADD", {
        userId: request.userId,
        channelId,
        messageId,
        guildId: channel?.guildId ?? null,
        emoji: { id: emojiId ?? null, name: emojiName },
      });

      return reply.status(204).send();
    }
  );

  app.delete(
    "/channels/:channelId/messages/:messageId/reactions/:emoji/@me",
    { preHandler: [createRateLimiter("reaction")] },
    async (request, reply) => {
      const { channelId, messageId, emoji } = request.params as {
        channelId: string;
        messageId: string;
        emoji: string;
      };

      const [emojiName, emojiId] = emoji.includes(":") ? emoji.split(":") : [emoji, undefined];
      await reactionService.removeReaction(messageId, request.userId, emojiName!, emojiId);

      const channel = await channelService.getChannel(channelId);
      await dispatchMessage(channelId, "MESSAGE_REACTION_REMOVE", {
        userId: request.userId,
        channelId,
        messageId,
        guildId: channel?.guildId ?? null,
        emoji: { id: emojiId ?? null, name: emojiName },
      });

      return reply.status(204).send();
    }
  );

  app.get(
    "/channels/:channelId/messages/:messageId/reactions/:emoji",
    async (request, reply) => {
      const { messageId, emoji } = request.params as {
        messageId: string;
        emoji: string;
      };

      const [emojiName, emojiId] = emoji.includes(":") ? emoji.split(":") : [emoji, undefined];
      const users = await reactionService.getReactions(messageId, emojiName!, emojiId);
      return reply.send(users);
    }
  );

  // ── Read State / Message Ack ──

  app.post("/channels/:channelId/messages/:messageId/ack", async (request, reply) => {
    const { channelId, messageId } = request.params as {
      channelId: string;
      messageId: string;
    };
    await readStateService.ackMessage(request.userId, channelId, messageId);
    return reply.status(204).send();
  });

  // ── Pinned messages ──

  app.get("/channels/:channelId/pins", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const channel = await channelService.getChannel(channelId);
    if (!channel) throw new ApiError(404, "Channel not found");
    if (channel.guildId) {
      const { isMember } = await import("../../services/guild.service.js");
      if (!(await isMember(request.userId, channel.guildId))) {
        throw new ApiError(403, "Not a member of this guild");
      }
    }
    const messages = await messageService.getPinnedMessages(channelId, request.userId);
    return reply.send(messages);
  });

  app.put("/channels/:channelId/pins/:messageId", async (request, reply) => {
    const { channelId, messageId } = request.params as { channelId: string; messageId: string };
    const channel = await channelService.getChannel(channelId);
    if (!channel) throw new ApiError(404, "Channel not found");
    if (channel.guildId) {
      await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_MESSAGES);
    }
    await messageService.pinMessage(messageId);
    await dispatchMessage(channelId, "CHANNEL_PINS_UPDATE", { channelId });
    return reply.status(204).send();
  });

  app.delete("/channels/:channelId/pins/:messageId", async (request, reply) => {
    const { channelId, messageId } = request.params as { channelId: string; messageId: string };
    const channel = await channelService.getChannel(channelId);
    if (!channel) throw new ApiError(404, "Channel not found");
    if (channel.guildId) {
      await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_MESSAGES);
    }
    await messageService.unpinMessage(messageId);
    await dispatchMessage(channelId, "CHANNEL_PINS_UPDATE", { channelId });
    return reply.status(204).send();
  });
}
