import { eq, and, lt, desc, inArray } from "drizzle-orm";
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

export async function getMessageWithAuthor(messageId: string, depth: number = 0): Promise<Record<string, any> | null> {
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

  const resolvedAuthor = author ?? {
    id: message.authorId,
    username: "Deleted User",
    displayName: null,
    avatar: null,
    status: "offline",
  };

  const attachments = await db
    .select()
    .from(schema.messageAttachments)
    .where(eq(schema.messageAttachments.messageId, messageId));

  // Get referenced message if exists (limit recursion to depth 1)
  let referencedMessage = null;
  if (message.referencedMessageId && depth < 1) {
    referencedMessage = await getMessageWithAuthor(message.referencedMessageId, depth + 1);
  }

  return {
    id: message.id,
    channelId: message.channelId,
    author: resolvedAuthor,
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
  const limitNum = Math.min(options?.limit ?? 50, 100);

  const rows = await db
    .select({
      message: schema.messages,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
        status: schema.users.status,
      },
    })
    .from(schema.messages)
    .leftJoin(schema.users, eq(schema.messages.authorId, schema.users.id))
    .where(
      options?.before
        ? and(
            eq(schema.messages.channelId, channelId),
            lt(schema.messages.id, options.before)
          )
        : eq(schema.messages.channelId, channelId)
    )
    .orderBy(desc(schema.messages.id))
    .limit(limitNum);

  if (rows.length === 0) return [];

  // Batch fetch attachments for all messages
  const messageIds = rows.map((r) => r.message.id);
  const allAttachments = await db
    .select()
    .from(schema.messageAttachments)
    .where(inArray(schema.messageAttachments.messageId, messageIds));

  const attachmentsByMessage = new Map<string, typeof allAttachments>();
  for (const att of allAttachments) {
    const list = attachmentsByMessage.get(att.messageId) ?? [];
    list.push(att);
    attachmentsByMessage.set(att.messageId, list);
  }

  // Batch fetch referenced messages (one level only)
  const refIds = rows
    .map((r) => r.message.referencedMessageId)
    .filter((id): id is string => id !== null);

  const referencedMessages = new Map<string, Record<string, any>>();
  if (refIds.length > 0) {
    const refRows = await db
      .select({
        message: schema.messages,
        author: {
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatar: schema.users.avatar,
          status: schema.users.status,
        },
      })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.authorId, schema.users.id))
      .where(inArray(schema.messages.id, refIds));

    for (const ref of refRows) {
      const refAuthor = ref.author ?? {
        id: ref.message.authorId,
        username: "Deleted User",
        displayName: null,
        avatar: null,
        status: "offline",
      };
      referencedMessages.set(ref.message.id, {
        id: ref.message.id,
        channelId: ref.message.channelId,
        author: refAuthor,
        content: ref.message.content,
        type: ref.message.type,
        flags: ref.message.flags,
        tts: ref.message.tts,
        mentionEveryone: ref.message.mentionEveryone,
        pinned: ref.message.pinned,
        editedTimestamp: ref.message.editedTimestamp?.toISOString() ?? null,
        referencedMessageId: ref.message.referencedMessageId,
        referencedMessage: null,
        webhookId: ref.message.webhookId,
        attachments: [],
        embeds: [],
        reactions: [],
        createdAt: ref.message.createdAt.toISOString(),
      });
    }
  }

  return rows.map((row) => {
    const author = row.author ?? {
      id: row.message.authorId,
      username: "Deleted User",
      displayName: null,
      avatar: null,
      status: "offline",
    };

    return {
      id: row.message.id,
      channelId: row.message.channelId,
      author,
      content: row.message.content,
      type: row.message.type,
      flags: row.message.flags,
      tts: row.message.tts,
      mentionEveryone: row.message.mentionEveryone,
      pinned: row.message.pinned,
      editedTimestamp: row.message.editedTimestamp?.toISOString() ?? null,
      referencedMessageId: row.message.referencedMessageId,
      referencedMessage: row.message.referencedMessageId
        ? referencedMessages.get(row.message.referencedMessageId) ?? null
        : null,
      webhookId: row.message.webhookId,
      attachments: attachmentsByMessage.get(row.message.id) ?? [],
      embeds: [],
      reactions: [],
      createdAt: row.message.createdAt.toISOString(),
    };
  });
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
  const rows = await db
    .select({
      message: schema.messages,
      author: {
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
        status: schema.users.status,
      },
    })
    .from(schema.messages)
    .leftJoin(schema.users, eq(schema.messages.authorId, schema.users.id))
    .where(and(eq(schema.messages.channelId, channelId), eq(schema.messages.pinned, true)))
    .orderBy(desc(schema.messages.id));

  if (rows.length === 0) return [];

  // Batch fetch attachments for all pinned messages
  const messageIds = rows.map((r) => r.message.id);
  const allAttachments = await db
    .select()
    .from(schema.messageAttachments)
    .where(inArray(schema.messageAttachments.messageId, messageIds));

  const attachmentsByMessage = new Map<string, typeof allAttachments>();
  for (const att of allAttachments) {
    const list = attachmentsByMessage.get(att.messageId) ?? [];
    list.push(att);
    attachmentsByMessage.set(att.messageId, list);
  }

  // Batch fetch referenced messages (one level only)
  const refIds = rows
    .map((r) => r.message.referencedMessageId)
    .filter((id): id is string => id !== null);

  const referencedMessages = new Map<string, Record<string, any>>();
  if (refIds.length > 0) {
    const refRows = await db
      .select({
        message: schema.messages,
        author: {
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatar: schema.users.avatar,
          status: schema.users.status,
        },
      })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.authorId, schema.users.id))
      .where(inArray(schema.messages.id, refIds));

    for (const ref of refRows) {
      const refAuthor = ref.author ?? {
        id: ref.message.authorId,
        username: "Deleted User",
        displayName: null,
        avatar: null,
        status: "offline",
      };
      referencedMessages.set(ref.message.id, {
        id: ref.message.id,
        channelId: ref.message.channelId,
        author: refAuthor,
        content: ref.message.content,
        type: ref.message.type,
        flags: ref.message.flags,
        tts: ref.message.tts,
        mentionEveryone: ref.message.mentionEveryone,
        pinned: ref.message.pinned,
        editedTimestamp: ref.message.editedTimestamp?.toISOString() ?? null,
        referencedMessageId: ref.message.referencedMessageId,
        referencedMessage: null,
        webhookId: ref.message.webhookId,
        attachments: [],
        embeds: [],
        reactions: [],
        createdAt: ref.message.createdAt.toISOString(),
      });
    }
  }

  return rows.map((row) => {
    const author = row.author ?? {
      id: row.message.authorId,
      username: "Deleted User",
      displayName: null,
      avatar: null,
      status: "offline",
    };

    return {
      id: row.message.id,
      channelId: row.message.channelId,
      author,
      content: row.message.content,
      type: row.message.type,
      flags: row.message.flags,
      tts: row.message.tts,
      mentionEveryone: row.message.mentionEveryone,
      pinned: row.message.pinned,
      editedTimestamp: row.message.editedTimestamp?.toISOString() ?? null,
      referencedMessageId: row.message.referencedMessageId,
      referencedMessage: row.message.referencedMessageId
        ? referencedMessages.get(row.message.referencedMessageId) ?? null
        : null,
      webhookId: row.message.webhookId,
      attachments: attachmentsByMessage.get(row.message.id) ?? [],
      embeds: [],
      reactions: [],
      createdAt: row.message.createdAt.toISOString(),
    };
  });
}
