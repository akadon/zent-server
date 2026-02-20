import { eq, and, inArray } from "drizzle-orm";
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

  // Use "" for unicode emoji (no custom ID) — keeps composite PK valid in PostgreSQL
  await db
    .insert(schema.messageReactions)
    .values({
      messageId,
      userId,
      emojiName,
      emojiId: emojiId ?? "",
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
  await db.delete(schema.messageReactions).where(
    and(
      eq(schema.messageReactions.messageId, messageId),
      eq(schema.messageReactions.userId, userId),
      eq(schema.messageReactions.emojiName, emojiName),
      eq(schema.messageReactions.emojiId, emojiId ?? "")
    )
  );
}

export async function getReactions(
  messageId: string,
  emojiName: string,
  emojiId?: string
) {
  const reactions = await db
    .select({ userId: schema.messageReactions.userId })
    .from(schema.messageReactions)
    .where(
      and(
        eq(schema.messageReactions.messageId, messageId),
        eq(schema.messageReactions.emojiName, emojiName),
        eq(schema.messageReactions.emojiId, emojiId ?? "")
      )
    );

  if (reactions.length === 0) return [];

  // Batch fetch all reacting users in one query
  const users = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, reactions.map((r) => r.userId)));

  return users;
}

export async function removeAllReactions(messageId: string) {
  await db
    .delete(schema.messageReactions)
    .where(eq(schema.messageReactions.messageId, messageId));
}
