import { eq, and, lt, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

export async function createMessage(
  channelId: string,
  authorId: string,
  content: string,
  options?: {
    type?: number;
    tts?: boolean;
    nonce?: string;
    referencedMessageId?: string;
  }
) {
  const id = generateSnowflake();

  const [message] = await db
    .insert(schema.messages)
    .values({
      id,
      channelId,
      authorId,
      content,
      type: options?.type ?? 0,
      tts: options?.tts ?? false,
      nonce: options?.nonce ?? null,
      referencedMessageId: options?.referencedMessageId ?? null,
      mentionEveryone: content.includes("@everyone") || content.includes("@here"),
    })
    .returning();

  // Update channel's last_message_id
  await db
    .update(schema.channels)
    .set({ lastMessageId: id })
    .where(eq(schema.channels.id, channelId));

  // Fetch full message with author
  return getMessageWithAuthor(id);
}

export async function getMessageWithAuthor(messageId: string): Promise<Record<string, any> | null> {
  const [message] = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!message) return null;

  const [author] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      status: schema.users.status,
    })
    .from(schema.users)
    .where(eq(schema.users.id, message.authorId))
    .limit(1);

  const attachments = await db
    .select()
    .from(schema.messageAttachments)
    .where(eq(schema.messageAttachments.messageId, messageId));

  // Get referenced message if exists
  let referencedMessage = null;
  if (message.referencedMessageId) {
    referencedMessage = await getMessageWithAuthor(message.referencedMessageId);
  }

  return {
    id: message.id,
    channelId: message.channelId,
    author: author!,
    content: message.content,
    type: message.type,
    flags: message.flags,
    tts: message.tts,
    mentionEveryone: message.mentionEveryone,
    pinned: message.pinned,
    editedTimestamp: message.editedTimestamp?.toISOString() ?? null,
    referencedMessageId: message.referencedMessageId,
    referencedMessage,
    webhookId: message.webhookId,
    attachments,
    embeds: [],
    reactions: [],
    createdAt: message.createdAt.toISOString(),
  };
}

export async function getChannelMessages(
  channelId: string,
  options?: { before?: string; limit?: number }
) {
  const limit = Math.min(options?.limit ?? 50, 100);

  let query = db
    .select()
    .from(schema.messages)
    .where(
      options?.before
        ? and(
            eq(schema.messages.channelId, channelId),
            lt(schema.messages.id, options.before)
          )
        : eq(schema.messages.channelId, channelId)
    )
    .orderBy(desc(schema.messages.id))
    .limit(limit);

  const messageList = await query;

  // Fetch authors and attachments for all messages
  const result = [];
  for (const msg of messageList) {
    const full = await getMessageWithAuthor(msg.id);
    if (full) result.push(full);
  }

  return result;
}

export async function updateMessage(
  messageId: string,
  userId: string,
  content: string
) {
  const [message] = await db
    .select({ authorId: schema.messages.authorId })
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!message) throw new ApiError(404, "Message not found");
  if (message.authorId !== userId) throw new ApiError(403, "Cannot edit another user's message");

  const [updated] = await db
    .update(schema.messages)
    .set({
      content,
      editedTimestamp: new Date(),
    })
    .where(eq(schema.messages.id, messageId))
    .returning();

  return getMessageWithAuthor(updated!.id);
}

export async function deleteMessage(messageId: string, userId: string) {
  const [message] = await db
    .select({
      authorId: schema.messages.authorId,
      channelId: schema.messages.channelId,
    })
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!message) throw new ApiError(404, "Message not found");

  // For now, only author can delete. Later: MANAGE_MESSAGES perm check
  if (message.authorId !== userId) {
    throw new ApiError(403, "Cannot delete another user's message");
  }

  await db.delete(schema.messages).where(eq(schema.messages.id, messageId));

  return { id: messageId, channelId: message.channelId };
}

export async function pinMessage(messageId: string) {
  await db
    .update(schema.messages)
    .set({ pinned: true })
    .where(eq(schema.messages.id, messageId));
}

export async function unpinMessage(messageId: string) {
  await db
    .update(schema.messages)
    .set({ pinned: false })
    .where(eq(schema.messages.id, messageId));
}

export async function getPinnedMessages(channelId: string) {
  const pinned = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.channelId, channelId), eq(schema.messages.pinned, true)))
    .orderBy(desc(schema.messages.id));

  const result = [];
  for (const msg of pinned) {
    const full = await getMessageWithAuthor(msg.id);
    if (full) result.push(full);
  }
  return result;
}
