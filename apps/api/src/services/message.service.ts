import { eq, and, lt, desc, inArray, count } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import * as pollService from "./poll.service.js";
import * as permissionService from "./permission.service.js";
import { PermissionFlags } from "@yxc/permissions";

// ── Reaction aggregation helpers ──

interface AggregatedReaction {
  emoji: { id: string | null; name: string };
  count: number;
  me: boolean;
}

async function getMessageReactions(messageId: string, currentUserId?: string): Promise<AggregatedReaction[]> {
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
}

async function getBatchMessageReactions(
  messageIds: string[],
  currentUserId?: string
): Promise<Map<string, AggregatedReaction[]>> {
  const result = new Map<string, AggregatedReaction[]>();
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
}

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
  const type = options?.type ?? 0;
  const tts = options?.tts ?? false;
  const nonce = options?.nonce ?? null;
  const referencedMessageId = options?.referencedMessageId ?? null;
  const mentionEveryone = content.includes("@everyone") || content.includes("@here");
  const createdAt = new Date();

  // Insert message and update channel concurrently, also fetch channel for retention
  const [, , [author], [channel]] = await Promise.all([
    db.insert(schema.messages).values({
      id,
      channelId,
      authorId,
      content,
      type,
      tts,
      nonce,
      referencedMessageId,
      mentionEveryone,
      createdAt,
    }),
    db.update(schema.channels).set({ lastMessageId: id }).where(eq(schema.channels.id, channelId)),
    db.select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      status: schema.users.status,
    }).from(schema.users).where(eq(schema.users.id, authorId)).limit(1),
    db.select({ messageRetentionSeconds: schema.channels.messageRetentionSeconds })
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1),
  ]);

  // Set message expiry based on channel retention policy
  if (channel?.messageRetentionSeconds) {
    const expiresAt = new Date(Date.now() + channel.messageRetentionSeconds * 1000);
    await db.update(schema.messages).set({ expiresAt }).where(eq(schema.messages.id, id));
  }

  const resolvedAuthor = author ?? {
    id: authorId,
    username: "Deleted User",
    displayName: null,
    avatar: null,
    status: "offline",
  };

  // Resolve referenced message if needed
  let referencedMessage = null;
  if (referencedMessageId) {
    referencedMessage = await getMessageWithAuthor(referencedMessageId, 1);
  }

  return {
    id,
    channelId,
    author: resolvedAuthor,
    content,
    type,
    flags: 0,
    tts,
    mentionEveryone,
    pinned: false,
    editedTimestamp: null,
    referencedMessageId,
    referencedMessage,
    webhookId: null,
    attachments: [],
    embeds: [],
    reactions: [],
    createdAt: createdAt.toISOString(),
  };
}

export async function getMessageWithAuthor(messageId: string, depth: number = 0, currentUserId?: string): Promise<Record<string, any> | null> {
  const [message] = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1);

  if (!message) return null;

  const [[author], attachments, reactions, poll] = await Promise.all([
    db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
        status: schema.users.status,
      })
      .from(schema.users)
      .where(eq(schema.users.id, message.authorId))
      .limit(1),
    db
      .select()
      .from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.messageId, messageId)),
    getMessageReactions(messageId, currentUserId),
    pollService.getPollByMessageId(messageId, currentUserId),
  ]);

  const resolvedAuthor = author ?? {
    id: message.authorId,
    username: "Deleted User",
    displayName: null,
    avatar: null,
    status: "offline",
  };

  // Get referenced message if exists (limit recursion to depth 1)
  let referencedMessage = null;
  if (message.referencedMessageId && depth < 1) {
    referencedMessage = await getMessageWithAuthor(message.referencedMessageId, depth + 1, currentUserId);
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
    reactions,
    poll: poll ?? undefined,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function getChannelMessages(
  channelId: string,
  options?: { before?: string; limit?: number },
  currentUserId?: string
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

  // Batch fetch attachments, reactions, and polls for all messages
  const messageIds = rows.map((r) => r.message.id);
  const [allAttachments, reactionsByMessage, allPolls] = await Promise.all([
    db
      .select()
      .from(schema.messageAttachments)
      .where(inArray(schema.messageAttachments.messageId, messageIds)),
    getBatchMessageReactions(messageIds, currentUserId),
    db
      .select()
      .from(schema.polls)
      .where(inArray(schema.polls.messageId, messageIds)),
  ]);

  const attachmentsByMessage = new Map<string, typeof allAttachments>();
  for (const att of allAttachments) {
    const list = attachmentsByMessage.get(att.messageId) ?? [];
    list.push(att);
    attachmentsByMessage.set(att.messageId, list);
  }

  // Batch fetch poll details (options + votes in 2 queries instead of N)
  const pollsByMessage = allPolls.length > 0
    ? await pollService.getBatchPolls(allPolls, currentUserId)
    : new Map<string, Record<string, any>>();

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

    const poll = pollsByMessage.get(row.message.id);

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
      reactions: reactionsByMessage.get(row.message.id) ?? [],
      poll: poll ?? undefined,
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

  await db
    .update(schema.messages)
    .set({
      content,
      editedTimestamp: new Date(),
    })
    .where(eq(schema.messages.id, messageId));

  return getMessageWithAuthor(messageId);
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

  if (message.authorId !== userId) {
    // Check if user has MANAGE_MESSAGES in this channel's guild
    const [channel] = await db
      .select({ guildId: schema.channels.guildId })
      .from(schema.channels)
      .where(eq(schema.channels.id, message.channelId))
      .limit(1);

    if (!channel?.guildId) {
      throw new ApiError(403, "Cannot delete another user's message");
    }

    await permissionService.requireGuildPermission(userId, channel.guildId, PermissionFlags.MANAGE_MESSAGES);
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

export async function getPinnedMessages(channelId: string, currentUserId?: string) {
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
    .orderBy(desc(schema.messages.id))
    .limit(50);

  if (rows.length === 0) return [];

  // Batch fetch attachments, reactions, and polls for all pinned messages
  const messageIds = rows.map((r) => r.message.id);
  const [allAttachments, reactionsByMessage, allPolls] = await Promise.all([
    db
      .select()
      .from(schema.messageAttachments)
      .where(inArray(schema.messageAttachments.messageId, messageIds)),
    getBatchMessageReactions(messageIds, currentUserId),
    db
      .select()
      .from(schema.polls)
      .where(inArray(schema.polls.messageId, messageIds)),
  ]);

  const attachmentsByMessage = new Map<string, typeof allAttachments>();
  for (const att of allAttachments) {
    const list = attachmentsByMessage.get(att.messageId) ?? [];
    list.push(att);
    attachmentsByMessage.set(att.messageId, list);
  }

  // Batch fetch poll details (options + votes in 2 queries instead of N)
  const pollsByMessage = allPolls.length > 0
    ? await pollService.getBatchPolls(allPolls, currentUserId)
    : new Map<string, Record<string, any>>();

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

    const poll = pollsByMessage.get(row.message.id);

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
      reactions: reactionsByMessage.get(row.message.id) ?? [],
      poll: poll ?? undefined,
      createdAt: row.message.createdAt.toISOString(),
    };
  });
}
