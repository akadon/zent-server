import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const readstateRepository = {
  async findByUserId(userId: string) {
    return db.select().from(schema.readStates).where(eq(schema.readStates.userId, userId));
  },
  async upsert(userId: string, channelId: string, lastMessageId: string) {
    await db
      .insert(schema.readStates)
      .values({ userId, channelId, lastMessageId, mentionCount: 0 })
      .onConflictDoUpdate({
        target: [schema.readStates.userId, schema.readStates.channelId],
        set: { lastMessageId, mentionCount: 0 },
      });
  },
  async incrementMentionCount(userId: string, channelId: string) {
    await db
      .insert(schema.readStates)
      .values({ userId, channelId, mentionCount: 1 })
      .onConflictDoUpdate({
        target: [schema.readStates.userId, schema.readStates.channelId],
        set: { mentionCount: sql`${schema.readStates.mentionCount} + 1` },
      });
  },
};
