import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import { isMember } from "../../services/guild.service.js";
import { db } from "../../db/index.js";
import { messages, channels } from "../../db/schema.js";
import { eq, and, like, lt, desc, sql } from "drizzle-orm";

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

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

    // Build conditions
    const conditions = [
      eq(channels.guildId, guildId),
      eq(messages.channelId, channels.id),
      like(messages.content, `%${escapeLike(query.q)}%`),
    ];

    if (query.channelId) {
      conditions.push(eq(messages.channelId, query.channelId));
    }

    if (query.authorId) {
      conditions.push(eq(messages.authorId, query.authorId));
    }

    if (query.before) {
      conditions.push(lt(messages.id, query.before));
    }

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .innerJoin(channels, eq(messages.channelId, channels.id))
      .where(
        and(
          eq(channels.guildId, guildId),
          like(messages.content, `%${escapeLike(query.q)}%`),
          ...(query.channelId ? [eq(messages.channelId, query.channelId)] : []),
          ...(query.authorId ? [eq(messages.authorId, query.authorId)] : []),
        )
      );

    // Get results
    const results = await db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        authorId: messages.authorId,
        content: messages.content,
        type: messages.type,
        flags: messages.flags,
        tts: messages.tts,
        mentionEveryone: messages.mentionEveryone,
        pinned: messages.pinned,
        editedTimestamp: messages.editedTimestamp,
        referencedMessageId: messages.referencedMessageId,
        webhookId: messages.webhookId,
        nonce: messages.nonce,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(channels, eq(messages.channelId, channels.id))
      .where(and(...conditions))
      .orderBy(desc(messages.id))
      .limit(query.limit);

    return reply.send({
      results: results.map((r) => ({
        ...r,
        editedTimestamp: r.editedTimestamp?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      totalCount: countResult?.count ?? 0,
    });
  });
}
