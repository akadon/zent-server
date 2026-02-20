import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as moderationQueueService from "../../services/moderation-queue.service.js";
import * as permissionService from "../../services/permission.service.js";
import * as guildService from "../../services/guild.service.js";
import { ApiError } from "../../services/auth.service.js";
import { PermissionFlags } from "@yxc/permissions";

export async function moderationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // Create a moderation queue item (report) - any guild member can report
  app.post("/guilds/:guildId/moderation/queue", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    if (!(await guildService.isMember(request.userId, guildId))) {
      throw new ApiError(403, "Not a member of this guild");
    }
    const body = z
      .object({
        type: z.enum(["message", "user", "automod"]),
        targetId: z.string().min(1),
        reason: z.string().min(1).max(2000),
      })
      .parse(request.body);

    const item = await moderationQueueService.createQueueItem(
      guildId,
      body.type,
      body.targetId,
      body.reason,
      request.userId
    );
    return reply.status(201).send(item);
  });

  // Get queue items
  app.get("/guilds/:guildId/moderation/queue", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MODERATE_MEMBERS);
    const query = z
      .object({ status: z.string().optional() })
      .parse(request.query);

    const items = await moderationQueueService.getQueueItems(guildId, query.status);
    return reply.send(items);
  });

  // Resolve a queue item
  app.post("/guilds/:guildId/moderation/queue/:itemId/resolve", async (request, reply) => {
    const { guildId, itemId } = request.params as { guildId: string; itemId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MODERATE_MEMBERS);
    const body = z
      .object({
        action: z.enum(["approved", "rejected", "escalated"]),
        note: z.string().max(2000).optional(),
      })
      .parse(request.body);

    const item = await moderationQueueService.resolveQueueItem(
      itemId,
      request.userId,
      body.action,
      body.note
    );
    return reply.send(item);
  });

  // Get moderator analytics
  app.get("/guilds/:guildId/moderation/analytics", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MODERATE_MEMBERS);
    const analytics = await moderationQueueService.getModeratorAnalytics(guildId);
    return reply.send(analytics);
  });
}
