import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import { isMember } from "../../services/guild.service.js";
import { searchRepository } from "../../repositories/search.repository.js";

export default async function searchRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);
  app.addHook("preHandler", createRateLimiter("global"));

  // GET /api/guilds/:guildId/search
  app.get("/guilds/:guildId/search", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    const query = z
      .object({
        q: z.string().min(1).max(200),
        channelId: z.string().optional(),
        authorId: z.string().optional(),
        before: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(25),
      })
      .parse(request.query);

    // Verify membership
    if (!(await isMember(request.userId, guildId))) {
      return reply.status(403).send({ message: "Not a member of this guild" });
    }

    const searchOptions = {
      channelId: query.channelId,
      authorId: query.authorId,
      before: query.before,
      limit: query.limit,
    };

    const [results, totalCount] = await Promise.all([
      searchRepository.searchGuildMessages(guildId, query.q, searchOptions),
      searchRepository.countGuildMessages(guildId, query.q, {
        channelId: query.channelId,
        authorId: query.authorId,
      }),
    ]);

    return reply.send({
      results: results.map((r) => ({
        ...r,
        editedTimestamp: r.editedTimestamp?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      totalCount,
    });
  });
}
