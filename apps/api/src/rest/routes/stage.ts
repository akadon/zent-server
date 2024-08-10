import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as stageService from "../../services/stage.service.js";
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

export async function stageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // Create stage instance
  app.post("/stage-instances", async (request, reply) => {
    const body = z
      .object({
        channelId: z.string(),
        topic: z.string().min(1).max(120),
        privacyLevel: z.number().int().min(1).max(2).optional(),
        sendStartNotification: z.boolean().optional(),
        guildScheduledEventId: z.string().optional(),
      })
      .parse(request.body);

    const channel = await channelService.getChannel(body.channelId);
    if (!channel || !channel.guildId) {
      throw new ApiError(404, "Channel not found");
    }

    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      body.channelId,
      PermissionFlags.MANAGE_CHANNELS
    );

    const instance = await stageService.createStageInstance(
      channel.guildId,
      body.channelId,
      {
        topic: body.topic,
        privacyLevel: body.privacyLevel,
        sendStartNotification: body.sendStartNotification,
        guildScheduledEventId: body.guildScheduledEventId,
      }
    );

    await dispatchGuild(channel.guildId, "STAGE_INSTANCE_CREATE", instance);
    return reply.status(201).send(instance);
  });

  // Get stage instance
  app.get("/stage-instances/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const instance = await stageService.getStageInstance(channelId);
    if (!instance) {
      throw new ApiError(404, "Stage instance not found");
    }
    return reply.send(instance);
  });

  // Update stage instance
  app.patch("/stage-instances/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        topic: z.string().min(1).max(120).optional(),
        privacyLevel: z.number().int().min(1).max(2).optional(),
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

    const instance = await stageService.updateStageInstance(channelId, body);
    await dispatchGuild(channel.guildId, "STAGE_INSTANCE_UPDATE", instance);
    return reply.send(instance);
  });

  // Delete stage instance
  app.delete("/stage-instances/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };

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

    const instance = await stageService.deleteStageInstance(channelId);
    await dispatchGuild(channel.guildId, "STAGE_INSTANCE_DELETE", instance);
    return reply.status(204).send();
  });

  // Request to speak
  app.post("/stage-instances/:channelId/request-to-speak", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) {
      throw new ApiError(404, "Channel not found");
    }

    await stageService.requestToSpeak(request.userId, channel.guildId, channelId);
    return reply.status(204).send();
  });

  // Invite to speak (moderator action)
  app.post("/stage-instances/:channelId/speakers/:userId", async (request, reply) => {
    const { channelId, userId } = request.params as { channelId: string; userId: string };

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) {
      throw new ApiError(404, "Channel not found");
    }

    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      channelId,
      PermissionFlags.MUTE_MEMBERS
    );

    await stageService.inviteToSpeak(userId, channel.guildId, channelId);
    await dispatchGuild(channel.guildId, "VOICE_STATE_UPDATE", {
      userId,
      guildId: channel.guildId,
      channelId,
      suppress: false,
    });
    return reply.status(204).send();
  });

  // Move to audience (moderator action)
  app.delete("/stage-instances/:channelId/speakers/:userId", async (request, reply) => {
    const { channelId, userId } = request.params as { channelId: string; userId: string };

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) {
      throw new ApiError(404, "Channel not found");
    }

    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      channelId,
      PermissionFlags.MUTE_MEMBERS
    );

    await stageService.moveToAudience(userId, channel.guildId, channelId);
    await dispatchGuild(channel.guildId, "VOICE_STATE_UPDATE", {
      userId,
      guildId: channel.guildId,
      channelId,
      suppress: true,
    });
    return reply.status(204).send();
  });

  // Get speakers
  app.get("/stage-instances/:channelId/speakers", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const speakers = await stageService.getSpeakers(channelId);
    return reply.send(speakers);
  });

  // Get audience
  app.get("/stage-instances/:channelId/audience", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const audience = await stageService.getAudience(channelId);
    return reply.send(audience);
  });
}
