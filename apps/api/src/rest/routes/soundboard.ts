import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as soundboardService from "../../services/soundboard.service.js";
import * as permissionService from "../../services/permission.service.js";
import * as guildService from "../../services/guild.service.js";
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

export async function soundboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ── Guild Sounds ──

  // Get guild sounds
  app.get("/guilds/:guildId/soundboard-sounds", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    if (!(await guildService.isMember(request.userId, guildId))) {
      throw new ApiError(403, "Not a member of this guild");
    }

    const sounds = await soundboardService.getGuildSounds(guildId);
    return reply.send({ items: sounds });
  });

  // Get single sound
  app.get("/guilds/:guildId/soundboard-sounds/:soundId", async (request, reply) => {
    const { guildId, soundId } = request.params as { guildId: string; soundId: string };

    if (!(await guildService.isMember(request.userId, guildId))) {
      throw new ApiError(403, "Not a member of this guild");
    }

    const sound = await soundboardService.getSound(soundId);
    if (!sound || sound.guildId !== guildId) {
      throw new ApiError(404, "Sound not found");
    }
    return reply.send(sound);
  });

  // Create sound
  app.post("/guilds/:guildId/soundboard-sounds", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        name: z.string().min(1).max(32),
        soundUrl: z.string().url(),
        volume: z.number().int().min(0).max(100).optional(),
        emojiId: z.string().optional(),
        emojiName: z.string().optional(),
      })
      .parse(request.body);

    // Use MANAGE_GUILD_EXPRESSIONS permission
    await permissionService.requireGuildPermission(
      request.userId,
      guildId,
      PermissionFlags.MANAGE_EMOJIS_AND_STICKERS
    );

    const sound = await soundboardService.createSound(guildId, request.userId, body);

    await dispatchGuild(guildId, "GUILD_SOUNDBOARD_SOUND_CREATE", sound);
    return reply.status(201).send(sound);
  });

  // Update sound
  app.patch("/guilds/:guildId/soundboard-sounds/:soundId", async (request, reply) => {
    const { guildId, soundId } = request.params as { guildId: string; soundId: string };
    const body = z
      .object({
        name: z.string().min(1).max(32).optional(),
        volume: z.number().int().min(0).max(100).optional(),
        emojiId: z.string().nullable().optional(),
        emojiName: z.string().nullable().optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(
      request.userId,
      guildId,
      PermissionFlags.MANAGE_EMOJIS_AND_STICKERS
    );

    const sound = await soundboardService.updateSound(guildId, soundId, body);

    await dispatchGuild(guildId, "GUILD_SOUNDBOARD_SOUND_UPDATE", sound);
    return reply.send(sound);
  });

  // Delete sound
  app.delete("/guilds/:guildId/soundboard-sounds/:soundId", async (request, reply) => {
    const { guildId, soundId } = request.params as { guildId: string; soundId: string };

    await permissionService.requireGuildPermission(
      request.userId,
      guildId,
      PermissionFlags.MANAGE_EMOJIS_AND_STICKERS
    );

    await soundboardService.deleteSound(guildId, soundId);

    await dispatchGuild(guildId, "GUILD_SOUNDBOARD_SOUND_DELETE", {
      soundId,
      guildId,
    });
    return reply.status(204).send();
  });

  // Play sound in voice channel
  app.post("/channels/:channelId/send-soundboard-sound", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        soundId: z.string(),
      })
      .parse(request.body);

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) {
      throw new ApiError(404, "Channel not found");
    }

    // Check if user can use soundboard in this channel
    await permissionService.requireChannelPermission(
      request.userId,
      channel.guildId,
      channelId,
      PermissionFlags.SPEAK // Use SPEAK permission for voice channels
    );

    const sound = await soundboardService.getSound(body.soundId);
    if (!sound) {
      throw new ApiError(404, "Sound not found");
    }

    // Dispatch to voice channel participants
    await dispatchGuild(channel.guildId, "VOICE_CHANNEL_EFFECT_SEND", {
      channelId,
      guildId: channel.guildId,
      userId: request.userId,
      soundId: body.soundId,
    });

    return reply.status(204).send();
  });

  // ── User Favorites ──

  // Get user favorites
  app.get("/users/@me/soundboard-sounds", async (request, reply) => {
    const favorites = await soundboardService.getUserFavorites(request.userId);
    return reply.send({ items: favorites });
  });

  // Add favorite
  app.put("/users/@me/soundboard-sounds/:soundId", async (request, reply) => {
    const { soundId } = request.params as { soundId: string };
    await soundboardService.addFavorite(request.userId, soundId);
    return reply.status(204).send();
  });

  // Remove favorite
  app.delete("/users/@me/soundboard-sounds/:soundId", async (request, reply) => {
    const { soundId } = request.params as { soundId: string };
    await soundboardService.removeFavorite(request.userId, soundId);
    return reply.status(204).send();
  });
}
