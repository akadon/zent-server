import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as forumTagService from "../../services/forum-tag.service.js";
import * as permissionService from "../../services/permission.service.js";
import * as channelService from "../../services/channel.service.js";
import { ApiError } from "../../services/auth.service.js";
import { PermissionFlags } from "@yxc/permissions";
import { redisPub } from "../../config/redis.js";

async function dispatchGuild(guildId: string, event: string, data: unknown) {
  await redisPub.publish(
    `gateway:guild:${guildId}`,
    JSON.stringify({ event, data })
  );
}

export async function forumTagRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ── Channel Tags ──

  // Get channel tags
  app.get("/channels/:channelId/tags", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const tags = await forumTagService.getChannelTags(channelId);
    return reply.send(tags);
  });

  // Create tag
  app.post("/channels/:channelId/tags", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        name: z.string().min(1).max(20),
        moderated: z.boolean().optional(),
        emojiId: z.string().optional(),
        emojiName: z.string().optional(),
      })
      .parse(request.body);

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) {
      throw new ApiError(404, "Channel not found");
    }

    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      channelId,
      PermissionFlags.MANAGE_CHANNELS
    );

    const tag = await forumTagService.createTag(channelId, body);

    await dispatchGuild(channel.guildId, "CHANNEL_UPDATE", {
      ...(await channelService.getChannel(channelId)),
      availableTags: await forumTagService.getChannelTags(channelId),
    });

    return reply.status(201).send(tag);
  });

  // Update tag
  app.patch("/channels/:channelId/tags/:tagId", async (request, reply) => {
    const { channelId, tagId } = request.params as { channelId: string; tagId: string };
    const body = z
      .object({
        name: z.string().min(1).max(20).optional(),
        moderated: z.boolean().optional(),
        emojiId: z.string().nullable().optional(),
        emojiName: z.string().nullable().optional(),
      })
      .parse(request.body);

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) {
      throw new ApiError(404, "Channel not found");
    }

    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      channelId,
      PermissionFlags.MANAGE_CHANNELS
    );

    const tag = await forumTagService.updateTag(tagId, body);

    await dispatchGuild(channel.guildId, "CHANNEL_UPDATE", {
      ...(await channelService.getChannel(channelId)),
      availableTags: await forumTagService.getChannelTags(channelId),
    });

    return reply.send(tag);
  });

  // Delete tag
  app.delete("/channels/:channelId/tags/:tagId", async (request, reply) => {
    const { channelId, tagId } = request.params as { channelId: string; tagId: string };

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) {
      throw new ApiError(404, "Channel not found");
    }

    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      channelId,
      PermissionFlags.MANAGE_CHANNELS
    );

    await forumTagService.deleteTag(tagId);

    await dispatchGuild(channel.guildId, "CHANNEL_UPDATE", {
      ...(await channelService.getChannel(channelId)),
      availableTags: await forumTagService.getChannelTags(channelId),
    });

    return reply.status(204).send();
  });

  // Reorder tags
  app.patch("/channels/:channelId/tags", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .array(
        z.object({
          id: z.string(),
          position: z.number().int(),
        })
      )
      .parse(request.body);

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) {
      throw new ApiError(404, "Channel not found");
    }

    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      channelId,
      PermissionFlags.MANAGE_CHANNELS
    );

    const tags = await forumTagService.reorderTags(channelId, body);

    await dispatchGuild(channel.guildId, "CHANNEL_UPDATE", {
      ...(await channelService.getChannel(channelId)),
      availableTags: tags,
    });

    return reply.send(tags);
  });

  // ── Post Tags (Thread/Post Tags) ──

  // Get post tags
  app.get("/channels/:threadId/applied-tags", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const tags = await forumTagService.getPostTags(threadId);
    return reply.send(tags);
  });

  // Set post tags
  app.put("/channels/:threadId/applied-tags", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const body = z.array(z.string()).parse(request.body);

    const channel = await channelService.getChannel(threadId);
    if (!channel || !channel.guildId || !channel.parentId) {
      throw new ApiError(404, "Thread not found");
    }

    // Check if user has permission
    let isModerator = false;
    try {
      await permissionService.requireChannelPermission(
        request.userId,
        channel.guildId,
        channel.parentId,
        PermissionFlags.MANAGE_THREADS
      );
      isModerator = true;
    } catch {
      // Not a moderator
    }

    const tags = await forumTagService.setPostTags(
      threadId,
      body,
      request.userId,
      isModerator
    );

    await dispatchGuild(channel.guildId, "THREAD_UPDATE", {
      id: threadId,
      guildId: channel.guildId,
      parentId: channel.parentId,
      appliedTags: tags.map((t) => t.id),
    });

    return reply.send(tags);
  });

  // Add single tag to post
  app.put("/channels/:threadId/applied-tags/:tagId", async (request, reply) => {
    const { threadId, tagId } = request.params as { threadId: string; tagId: string };

    const channel = await channelService.getChannel(threadId);
    if (!channel || !channel.guildId || !channel.parentId) {
      throw new ApiError(404, "Thread not found");
    }

    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      threadId,
      PermissionFlags.SEND_MESSAGES
    );

    // Check if tag is moderated
    const tag = await forumTagService.getTag(tagId);
    if (tag?.moderated) {
      await permissionService.requireChannelPermission(
        request.userId,
        channel.guildId,
        channel.parentId,
        PermissionFlags.MANAGE_THREADS
      );
    }

    await forumTagService.addTagToPost(channel.parentId, threadId, tagId);

    const tags = await forumTagService.getPostTags(threadId);

    await dispatchGuild(channel.guildId, "THREAD_UPDATE", {
      id: threadId,
      guildId: channel.guildId,
      parentId: channel.parentId,
      appliedTags: tags.map((t) => t.id),
    });

    return reply.status(204).send();
  });

  // Remove tag from post
  app.delete("/channels/:threadId/applied-tags/:tagId", async (request, reply) => {
    const { threadId, tagId } = request.params as { threadId: string; tagId: string };

    const channel = await channelService.getChannel(threadId);
    if (!channel || !channel.guildId || !channel.parentId) {
      throw new ApiError(404, "Thread not found");
    }

    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      threadId,
      PermissionFlags.SEND_MESSAGES
    );

    await forumTagService.removeTagFromPost(threadId, tagId);

    const tags = await forumTagService.getPostTags(threadId);

    await dispatchGuild(channel.guildId, "THREAD_UPDATE", {
      id: threadId,
      guildId: channel.guildId,
      parentId: channel.parentId,
      appliedTags: tags.map((t) => t.id),
    });

    return reply.status(204).send();
  });
}
