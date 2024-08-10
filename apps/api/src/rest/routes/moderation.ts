import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as moderationQueueService from "../../services/moderation-queue.service.js";

export async function moderationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // Create a moderation queue item (report)
  app.post("/guilds/:guildId/moderation/queue", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
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
    const query = z
      .object({ status: z.string().optional() })
      .parse(request.query);

    const items = await moderationQueueService.getQueueItems(guildId, query.status);
    return reply.send(items);
  });

  // Resolve a queue item
  app.post("/guilds/:guildId/moderation/queue/:itemId/resolve", async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
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
    const analytics = await moderationQueueService.getModeratorAnalytics(guildId);
    return reply.send(analytics);
  });
}
