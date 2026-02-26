import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as stickerService from "../../services/sticker.service.js";
import * as permissionService from "../../services/permission.service.js";
import * as guildService from "../../services/guild.service.js";
import { ApiError } from "../../services/auth.service.js";
import { PermissionFlags } from "@yxc/permissions";
import { redisPub } from "../../config/redis.js";

async function dispatchGuild(guildId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  const now = Date.now();
  await Promise.all([
    redisPub.publish(`gateway:guild:${guildId}`, payload),
    redisPub.zadd(`guild_events:${guildId}`, now, `${now}:${payload}`),
    redisPub.zremrangebyscore(`guild_events:${guildId}`, "-inf", now - 60000),
  ]);
}

export async function stickerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ── Guild Stickers ──

  // Get guild stickers
  app.get("/guilds/:guildId/stickers", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    if (!(await guildService.isMember(request.userId, guildId))) {
      throw new ApiError(403, "Not a member of this guild");
    }

    const stickers = await stickerService.getGuildStickers(guildId);
    return reply.send(stickers);
  });

  // Get single sticker
  app.get("/stickers/:stickerId", async (request, reply) => {
    const { stickerId } = request.params as { stickerId: string };
    const sticker = await stickerService.getSticker(stickerId);
    if (!sticker) {
      throw new ApiError(404, "Sticker not found");
    }
    return reply.send(sticker);
  });

  // Get guild sticker
  app.get("/guilds/:guildId/stickers/:stickerId", async (request, reply) => {
    const { guildId, stickerId } = request.params as { guildId: string; stickerId: string };

    if (!(await guildService.isMember(request.userId, guildId))) {
      throw new ApiError(403, "Not a member of this guild");
    }

    const sticker = await stickerService.getSticker(stickerId);
    if (!sticker || sticker.guildId !== guildId) {
      throw new ApiError(404, "Sticker not found");
    }
    return reply.send(sticker);
  });

  // Create guild sticker
  app.post("/guilds/:guildId/stickers", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        name: z.string().min(2).max(30),
        description: z.string().max(100).optional(),
        tags: z.string().min(1).max(200),
        formatType: z.number().int().min(1).max(4),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(
      request.userId,
      guildId,
      PermissionFlags.MANAGE_EMOJIS_AND_STICKERS
    );

    if (!stickerService.validateStickerFormat(body.formatType)) {
      throw new ApiError(400, "Invalid sticker format");
    }

    const sticker = await stickerService.createGuildSticker(
      guildId,
      request.userId,
      body
    );

    await dispatchGuild(guildId, "GUILD_STICKERS_UPDATE", {
      guildId,
      stickers: await stickerService.getGuildStickers(guildId),
    });

    return reply.status(201).send(sticker);
  });

  // Update guild sticker
  app.patch("/guilds/:guildId/stickers/:stickerId", async (request, reply) => {
    const { guildId, stickerId } = request.params as { guildId: string; stickerId: string };
    const body = z
      .object({
        name: z.string().min(2).max(30).optional(),
        description: z.string().max(100).nullable().optional(),
        tags: z.string().min(1).max(200).optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(
      request.userId,
      guildId,
      PermissionFlags.MANAGE_EMOJIS_AND_STICKERS
    );

    const sticker = await stickerService.updateGuildSticker(guildId, stickerId, body);

    await dispatchGuild(guildId, "GUILD_STICKERS_UPDATE", {
      guildId,
      stickers: await stickerService.getGuildStickers(guildId),
    });

    return reply.send(sticker);
  });

  // Delete guild sticker
  app.delete("/guilds/:guildId/stickers/:stickerId", async (request, reply) => {
    const { guildId, stickerId } = request.params as { guildId: string; stickerId: string };

    await permissionService.requireGuildPermission(
      request.userId,
      guildId,
      PermissionFlags.MANAGE_EMOJIS_AND_STICKERS
    );

    await stickerService.deleteGuildSticker(guildId, stickerId);

    await dispatchGuild(guildId, "GUILD_STICKERS_UPDATE", {
      guildId,
      stickers: await stickerService.getGuildStickers(guildId),
    });

    return reply.status(204).send();
  });

  // ── Standard Stickers ──

  // Get standard stickers
  app.get("/sticker-packs", async (request, reply) => {
    const stickers = await stickerService.getStandardStickers();
    return reply.send({ stickerPacks: [{ id: "standard", stickers }] });
  });
}
