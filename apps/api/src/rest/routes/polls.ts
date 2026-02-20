import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import * as pollService from "../../services/poll.service.js";
import * as messageService from "../../services/message.service.js";
import * as channelService from "../../services/channel.service.js";
import { ApiError } from "../../services/auth.service.js";
import * as permissionService from "../../services/permission.service.js";
import { PermissionFlags } from "@yxc/permissions";
import { redisPub } from "../../config/redis.js";
import { generateSnowflake } from "@yxc/snowflake";
import { db, schema } from "../../db/index.js";

async function dispatchMessage(channelId: string, event: string, data: unknown) {
  const channel = await channelService.getChannel(channelId);
  if (!channel) return;

  if (channel.guildId) {
    await redisPub.publish(
      `gateway:guild:${channel.guildId}`,
      JSON.stringify({ event, data })
    );
  }
}

export async function pollRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // Create a poll (creates a message with a poll attached)
  app.post("/channels/:channelId/polls", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        question: z.string().min(1).max(300),
        options: z.array(z.string().min(1).max(100)).min(2).max(10),
        allowMultiselect: z.boolean().optional(),
        anonymous: z.boolean().optional(),
        duration: z.number().int().min(60).max(604800).optional(), // 1min to 7days
      })
      .parse(request.body);

    // Create the message first
    const message = await messageService.createMessage(
      channelId,
      request.userId,
      `📊 **${body.question}**`,
      {}
    );

    if (!message) {
      throw new ApiError(500, "Failed to create poll message");
    }

    // Create the poll
    const poll = await pollService.createPoll(
      channelId,
      message.id,
      body.question,
      body.options,
      {
        allowMultiselect: body.allowMultiselect,
        anonymous: body.anonymous,
        duration: body.duration,
      }
    );

    const fullMessage = { ...message, poll };
    await dispatchMessage(channelId, "MESSAGE_CREATE", fullMessage);

    return reply.status(201).send(fullMessage);
  });

  // Get poll
  app.get("/channels/:channelId/polls/:pollId", async (request, reply) => {
    const { pollId } = request.params as { pollId: string };
    const poll = await pollService.getPoll(pollId, request.userId);
    if (!poll) throw new ApiError(404, "Poll not found");
    return reply.send(poll);
  });

  // Vote on a poll
  app.put(
    "/channels/:channelId/polls/:pollId/votes/:optionId",
    { preHandler: [createRateLimiter("reaction")] },
    async (request, reply) => {
      const { channelId, pollId, optionId } = request.params as {
        channelId: string;
        pollId: string;
        optionId: string;
      };

      const result = await pollService.votePoll(pollId, optionId, request.userId);

      const channel = await channelService.getChannel(channelId);
      await dispatchMessage(channelId, "POLL_VOTE_ADD", {
        pollId,
        optionId,
        userId: request.userId,
        channelId,
        messageId: result.messageId,
        guildId: channel?.guildId ?? null,
      });

      return reply.status(204).send();
    }
  );

  // Remove vote from a poll
  app.delete(
    "/channels/:channelId/polls/:pollId/votes/:optionId",
    async (request, reply) => {
      const { channelId, pollId, optionId } = request.params as {
        channelId: string;
        pollId: string;
        optionId: string;
      };

      const result = await pollService.removePollVote(pollId, optionId, request.userId);

      const channel = await channelService.getChannel(channelId);
      await dispatchMessage(channelId, "POLL_VOTE_REMOVE", {
        pollId,
        optionId,
        userId: request.userId,
        channelId,
        messageId: result.messageId,
        guildId: channel?.guildId ?? null,
      });

      return reply.status(204).send();
    }
  );

  // End a poll early
  app.post("/channels/:channelId/polls/:pollId/end", async (request, reply) => {
    const { channelId, pollId } = request.params as {
      channelId: string;
      pollId: string;
    };

    // Verify the user is the poll creator or has MANAGE_MESSAGES
    const existingPoll = await pollService.getPoll(pollId, request.userId);
    if (!existingPoll) throw new ApiError(404, "Poll not found");

    const pollMessage = await messageService.getMessageWithAuthor(existingPoll.messageId);
    const isCreator = pollMessage?.author?.id === request.userId;
    if (!isCreator) {
      const channel = await channelService.getChannel(channelId);
      if (channel?.guildId) {
        await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_MESSAGES);
      } else {
        throw new ApiError(403, "Only the poll creator can end this poll");
      }
    }

    const poll = await pollService.endPoll(pollId, request.userId);
    if (!poll) throw new ApiError(404, "Poll not found");

    await dispatchMessage(channelId, "POLL_END", {
      pollId,
      channelId,
      messageId: poll.messageId,
      poll,
    });

    return reply.send(poll);
  });
}
