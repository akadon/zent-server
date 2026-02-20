import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export async function ackMessage(userId: string, channelId: string, messageId: string) {
  await db
    .insert(schema.readStates)
    .values({
      userId,
      channelId,
      lastMessageId: messageId,
      mentionCount: 0,
    })
    .onConflictDoUpdate({
      target: [schema.readStates.userId, schema.readStates.channelId],
      set: {
        lastMessageId: messageId,
        mentionCount: 0,
      },
    });
}

export async function getReadStates(userId: string) {
  return db
    .select()
    .from(schema.readStates)
    .where(eq(schema.readStates.userId, userId));
}

export async function incrementMentionCount(userId: string, channelId: string) {
  const [existing] = await db
    .select()
    .from(schema.readStates)
    .where(
      and(
        eq(schema.readStates.userId, userId),
        eq(schema.readStates.channelId, channelId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.readStates)
      .set({ mentionCount: existing.mentionCount + 1 })
      .where(
        and(
          eq(schema.readStates.userId, userId),
          eq(schema.readStates.channelId, channelId)
        )
      );
  } else {
    await db.insert(schema.readStates).values({
      userId,
      channelId,
      lastMessageId: null,
      mentionCount: 1,
    });
  }
}
