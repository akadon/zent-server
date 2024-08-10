import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { ApiError } from "./auth.service.js";

export async function addReaction(
  messageId: string,
  userId: string,
  emojiName: string,
  emojiId?: string
) {
  // Verify message exists
  const [message] = await db
    .select({ id: schema.messages.id, channelId: schema.messages.channelId })
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!message) throw new ApiError(404, "Message not found");

  await db
    .insert(schema.messageReactions)
    .values({
      messageId,
      userId,
      emojiName,
      emojiId: emojiId ?? null,
    })
    .onConflictDoNothing();

  return { messageId, channelId: message.channelId, emojiName, emojiId: emojiId ?? null };
}

export async function removeReaction(
  messageId: string,
  userId: string,
  emojiName: string,
  emojiId?: string
) {
  const conditions = [
    eq(schema.messageReactions.messageId, messageId),
    eq(schema.messageReactions.userId, userId),
    eq(schema.messageReactions.emojiName, emojiName),
  ];

  if (emojiId) {
    conditions.push(eq(schema.messageReactions.emojiId, emojiId));
  }

  await db.delete(schema.messageReactions).where(and(...conditions));
}

export async function getReactions(
  messageId: string,
  emojiName: string,
  emojiId?: string
) {
  const conditions = [
    eq(schema.messageReactions.messageId, messageId),
    eq(schema.messageReactions.emojiName, emojiName),
  ];

  if (emojiId) {
    conditions.push(eq(schema.messageReactions.emojiId, emojiId));
  }

  const reactions = await db
    .select({
      userId: schema.messageReactions.userId,
    })
    .from(schema.messageReactions)
    .where(and(...conditions));

  // Fetch user data
  const users = [];
  for (const r of reactions) {
    const [user] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
      })
      .from(schema.users)
      .where(eq(schema.users.id, r.userId))
      .limit(1);
    if (user) users.push(user);
  }

  return users;
}

export async function removeAllReactions(messageId: string) {
  await db
    .delete(schema.messageReactions)
    .where(eq(schema.messageReactions.messageId, messageId));
}
