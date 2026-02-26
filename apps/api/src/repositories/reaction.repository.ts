import { eq, and, inArray, count } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const reactionRepository = {
  async findByMessageId(messageId: string) {
    return db
      .select()
      .from(schema.messageReactions)
      .where(eq(schema.messageReactions.messageId, messageId));
  },
  async getAggregated(messageId: string, currentUserId?: string) {
    const rows = await db
      .select({
        emojiName: schema.messageReactions.emojiName,
        emojiId: schema.messageReactions.emojiId,
        count: count(),
      })
      .from(schema.messageReactions)
      .where(eq(schema.messageReactions.messageId, messageId))
      .groupBy(schema.messageReactions.emojiName, schema.messageReactions.emojiId);

    if (rows.length === 0) return [];

    let myReactions = new Set<string>();
    if (currentUserId) {
      const myRows = await db
        .select({
          emojiName: schema.messageReactions.emojiName,
          emojiId: schema.messageReactions.emojiId,
        })
        .from(schema.messageReactions)
        .where(
          and(
            eq(schema.messageReactions.messageId, messageId),
            eq(schema.messageReactions.userId, currentUserId)
          )
        );
      for (const r of myRows) {
        myReactions.add(`${r.emojiName}:${r.emojiId ?? ""}`);
      }
    }

    return rows.map((r) => ({
      emoji: { id: r.emojiId ?? null, name: r.emojiName },
      count: r.count,
      me: myReactions.has(`${r.emojiName}:${r.emojiId ?? ""}`),
    }));
  },
  async getBatchAggregated(messageIds: string[], currentUserId?: string) {
    const result = new Map<string, { emoji: { id: string | null; name: string }; count: number; me: boolean }[]>();
    if (messageIds.length === 0) return result;

    const rows = await db
      .select({
        messageId: schema.messageReactions.messageId,
        emojiName: schema.messageReactions.emojiName,
        emojiId: schema.messageReactions.emojiId,
        count: count(),
      })
      .from(schema.messageReactions)
      .where(inArray(schema.messageReactions.messageId, messageIds))
      .groupBy(
        schema.messageReactions.messageId,
        schema.messageReactions.emojiName,
        schema.messageReactions.emojiId
      );

    if (rows.length === 0) return result;

    let myReactions = new Set<string>();
    if (currentUserId) {
      const myRows = await db
        .select({
          messageId: schema.messageReactions.messageId,
          emojiName: schema.messageReactions.emojiName,
          emojiId: schema.messageReactions.emojiId,
        })
        .from(schema.messageReactions)
        .where(
          and(
            inArray(schema.messageReactions.messageId, messageIds),
            eq(schema.messageReactions.userId, currentUserId)
          )
        );
      for (const r of myRows) {
        myReactions.add(`${r.messageId}:${r.emojiName}:${r.emojiId ?? ""}`);
      }
    }

    for (const r of rows) {
      const list = result.get(r.messageId) ?? [];
      list.push({
        emoji: { id: r.emojiId ?? null, name: r.emojiName },
        count: r.count,
        me: myReactions.has(`${r.messageId}:${r.emojiName}:${r.emojiId ?? ""}`),
      });
      result.set(r.messageId, list);
    }

    return result;
  },
  async create(data: {
    messageId: string;
    userId: string;
    emojiName: string;
    emojiId?: string;
  }) {
    await db.insert(schema.messageReactions).values({
      messageId: data.messageId,
      userId: data.userId,
      emojiName: data.emojiName,
      emojiId: data.emojiId ?? "",
    });
  },
  async createIgnoreConflict(data: {
    messageId: string;
    userId: string;
    emojiName: string;
    emojiId?: string;
  }) {
    await db
      .insert(schema.messageReactions)
      .values({
        messageId: data.messageId,
        userId: data.userId,
        emojiName: data.emojiName,
        emojiId: data.emojiId ?? "",
      })
      .onConflictDoNothing();
  },
  async findUsersWithDetails(messageId: string, emojiName: string, emojiId?: string) {
    const reactions = await db
      .select({ userId: schema.messageReactions.userId })
      .from(schema.messageReactions)
      .where(
        and(
          eq(schema.messageReactions.messageId, messageId),
          eq(schema.messageReactions.emojiName, emojiName),
          eq(schema.messageReactions.emojiId, emojiId ?? ""),
        ),
      );
    if (reactions.length === 0) return [];
    return db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, reactions.map((r) => r.userId)));
  },
  async delete(messageId: string, userId: string, emojiName: string, emojiId?: string) {
    await db
      .delete(schema.messageReactions)
      .where(
        and(
          eq(schema.messageReactions.messageId, messageId),
          eq(schema.messageReactions.userId, userId),
          eq(schema.messageReactions.emojiName, emojiName),
          eq(schema.messageReactions.emojiId, emojiId ?? ""),
        ),
      );
  },
  async deleteAllForMessage(messageId: string) {
    await db
      .delete(schema.messageReactions)
      .where(eq(schema.messageReactions.messageId, messageId));
  },
  async findUsers(messageId: string, emojiName: string, emojiId?: string) {
    return db
      .select()
      .from(schema.messageReactions)
      .where(
        and(
          eq(schema.messageReactions.messageId, messageId),
          eq(schema.messageReactions.emojiName, emojiName),
          eq(schema.messageReactions.emojiId, emojiId ?? ""),
        ),
      );
  },
};
