import { eq, and, like, lt, desc, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

export const searchRepository = {
  async searchGuildMessages(
    guildId: string,
    query: string,
    options?: {
      channelId?: string;
      authorId?: string;
      before?: string;
      limit?: number;
    },
  ) {
    const limit = options?.limit ?? 25;
    const escapedQuery = `%${escapeLike(query)}%`;

    const conditions = [
      eq(schema.channels.guildId, guildId),
      eq(schema.messages.channelId, schema.channels.id),
      like(schema.messages.content, escapedQuery),
    ];

    if (options?.channelId) {
      conditions.push(eq(schema.messages.channelId, options.channelId));
    }
    if (options?.authorId) {
      conditions.push(eq(schema.messages.authorId, options.authorId));
    }
    if (options?.before) {
      conditions.push(lt(schema.messages.id, options.before));
    }

    const results = await db
      .select({
        id: schema.messages.id,
        channelId: schema.messages.channelId,
        authorId: schema.messages.authorId,
        content: schema.messages.content,
        type: schema.messages.type,
        flags: schema.messages.flags,
        tts: schema.messages.tts,
        mentionEveryone: schema.messages.mentionEveryone,
        pinned: schema.messages.pinned,
        editedTimestamp: schema.messages.editedTimestamp,
        referencedMessageId: schema.messages.referencedMessageId,
        webhookId: schema.messages.webhookId,
        nonce: schema.messages.nonce,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .innerJoin(schema.channels, eq(schema.messages.channelId, schema.channels.id))
      .where(and(...conditions))
      .orderBy(desc(schema.messages.id))
      .limit(limit);

    return results;
  },

  async countGuildMessages(
    guildId: string,
    query: string,
    options?: {
      channelId?: string;
      authorId?: string;
    },
  ) {
    const escapedQuery = `%${escapeLike(query)}%`;

    const countConditions = [
      eq(schema.channels.guildId, guildId),
      like(schema.messages.content, escapedQuery),
    ];

    if (options?.channelId) {
      countConditions.push(eq(schema.messages.channelId, options.channelId));
    }
    if (options?.authorId) {
      countConditions.push(eq(schema.messages.authorId, options.authorId));
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.messages)
      .innerJoin(schema.channels, eq(schema.messages.channelId, schema.channels.id))
      .where(and(...countConditions));

    return countResult?.count ?? 0;
  },
};
