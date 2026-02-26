import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import * as pollService from "./poll.service.js";
import * as permissionService from "./permission.service.js";
import { PermissionFlags } from "@yxc/permissions";
import { messageRepository } from "../repositories/message.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { channelRepository } from "../repositories/channel.repository.js";
import { reactionRepository } from "../repositories/reaction.repository.js";
import { pollRepository } from "../repositories/poll.repository.js";

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

  // Fetch author + channel first, then write message with embedded snapshot
  const [author, channel] = await Promise.all([
    userRepository.findPublicById(authorId),
    channelRepository.findById(channelId),
  ]);

  const authorSnapshot = author
    ? { id: author.id, username: author.username, displayName: author.displayName, avatar: author.avatar }
    : { id: authorId, username: "Deleted User", displayName: null, avatar: null };

  await Promise.all([
    messageRepository.create({
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
      authorSnapshot,
    }),
    messageRepository.updateLastMessageId(channelId, id),
  ]);

  // Set message expiry based on channel retention policy
  if (channel?.messageRetentionSeconds) {
    const expiresAt = new Date(Date.now() + channel.messageRetentionSeconds * 1000);
    await messageRepository.update(id, { expiresAt });
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
  const message = await messageRepository.findById(messageId);

  if (!message) return null;

  const [author, attachments, reactions, poll] = await Promise.all([
    userRepository.findPublicById(message.authorId),
    messageRepository.findAttachmentsByMessageIds([messageId]),
    reactionRepository.getAggregated(messageId, currentUserId),
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

  // Primary path: no JOIN, uses embedded authorSnapshot (NoSQL-ready)
  const messages = await messageRepository.findByChannelId(channelId, { before: options?.before, limit: limitNum });

  if (messages.length === 0) return [];

  const messageIds = messages.map((m) => m.id);

  // Batch fetch attachments, reactions, polls (3 queries total, not N)
  const [allAttachments, reactionsByMessage, allPolls] = await Promise.all([
    messageRepository.findAttachmentsByMessageIds(messageIds),
    reactionRepository.getBatchAggregated(messageIds, currentUserId),
    pollRepository.findByMessageIds(messageIds),
  ]);

  const attachmentsByMessage = new Map<string, typeof allAttachments>();
  for (const att of allAttachments) {
    const list = attachmentsByMessage.get(att.messageId) ?? [];
    list.push(att);
    attachmentsByMessage.set(att.messageId, list);
  }

  const pollsByMessage = allPolls.length > 0
    ? await pollService.getBatchPolls(allPolls, currentUserId)
    : new Map<string, Record<string, any>>();

  // Batch fetch referenced messages (one level only, uses snapshot too)
  const refIds = messages
    .map((m) => m.referencedMessageId)
    .filter((id): id is string => id !== null);

  const referencedMessages = new Map<string, Record<string, any>>();
  if (refIds.length > 0) {
    const refRows = await messageRepository.findByIdsWithAuthor(refIds);
    for (const ref of refRows) {
      const refAuthor = (ref.message.authorSnapshot as any) ?? ref.author ?? {
        id: ref.message.authorId, username: "Deleted User", displayName: null, avatar: null, status: "offline",
      };
      referencedMessages.set(ref.message.id, {
        id: ref.message.id, channelId: ref.message.channelId, author: refAuthor,
        content: ref.message.content, type: ref.message.type, flags: ref.message.flags,
        tts: ref.message.tts, mentionEveryone: ref.message.mentionEveryone,
        pinned: ref.message.pinned, editedTimestamp: ref.message.editedTimestamp?.toISOString() ?? null,
        referencedMessageId: ref.message.referencedMessageId, referencedMessage: null,
        webhookId: ref.message.webhookId, attachments: [], embeds: [], reactions: [],
        createdAt: ref.message.createdAt.toISOString(),
      });
    }
  }

  return messages.map((msg) => {
    // Prefer embedded snapshot; fall back to authorId-based stub for old messages
    const author = (msg.authorSnapshot as any) ?? {
      id: msg.authorId, username: "Deleted User", displayName: null, avatar: null, status: "offline",
    };

    return {
      id: msg.id,
      channelId: msg.channelId,
      author,
      content: msg.content,
      type: msg.type,
      flags: msg.flags,
      tts: msg.tts,
      mentionEveryone: msg.mentionEveryone,
      pinned: msg.pinned,
      editedTimestamp: msg.editedTimestamp?.toISOString() ?? null,
      referencedMessageId: msg.referencedMessageId,
      referencedMessage: msg.referencedMessageId
        ? referencedMessages.get(msg.referencedMessageId) ?? null
        : null,
      webhookId: msg.webhookId,
      attachments: attachmentsByMessage.get(msg.id) ?? [],
      embeds: [],
      reactions: reactionsByMessage.get(msg.id) ?? [],
      poll: pollsByMessage.get(msg.id) ?? undefined,
      createdAt: msg.createdAt.toISOString(),
    };
  });
}

export async function updateMessage(
  messageId: string,
  userId: string,
  content: string
) {
  const message = await messageRepository.findById(messageId);

  if (!message) throw new ApiError(404, "Message not found");
  if (message.authorId !== userId) throw new ApiError(403, "Cannot edit another user's message");

  await messageRepository.update(messageId, {
    content,
    editedTimestamp: new Date(),
  });

  return getMessageWithAuthor(messageId);
}

export async function deleteMessage(messageId: string, userId: string) {
  const message = await messageRepository.findById(messageId);

  if (!message) throw new ApiError(404, "Message not found");

  if (message.authorId !== userId) {
    // Check if user has MANAGE_MESSAGES in this channel's guild
    const channel = await channelRepository.findById(message.channelId);

    if (!channel?.guildId) {
      throw new ApiError(403, "Cannot delete another user's message");
    }

    await permissionService.requireGuildPermission(userId, channel.guildId, PermissionFlags.MANAGE_MESSAGES);
  }

  await messageRepository.delete(messageId);

  return { id: messageId, channelId: message.channelId };
}

export async function pinMessage(messageId: string) {
  await messageRepository.setPin(messageId, true);
}

export async function unpinMessage(messageId: string) {
  await messageRepository.setPin(messageId, false);
}

export async function getPinnedMessages(channelId: string, currentUserId?: string) {
  const messages = await messageRepository.findPinned(channelId);

  if (messages.length === 0) return [];

  const messageIds = messages.map((m) => m.id);
  const [allAttachments, reactionsByMessage, allPolls] = await Promise.all([
    messageRepository.findAttachmentsByMessageIds(messageIds),
    reactionRepository.getBatchAggregated(messageIds, currentUserId),
    pollRepository.findByMessageIds(messageIds),
  ]);

  const attachmentsByMessage = new Map<string, typeof allAttachments>();
  for (const att of allAttachments) {
    const list = attachmentsByMessage.get(att.messageId) ?? [];
    list.push(att);
    attachmentsByMessage.set(att.messageId, list);
  }

  const pollsByMessage = allPolls.length > 0
    ? await pollService.getBatchPolls(allPolls, currentUserId)
    : new Map<string, Record<string, any>>();

  const refIds = messages.map((m) => m.referencedMessageId).filter((id): id is string => id !== null);
  const referencedMessages = new Map<string, Record<string, any>>();
  if (refIds.length > 0) {
    const refRows = await messageRepository.findByIdsWithAuthor(refIds);
    for (const ref of refRows) {
      const refAuthor = (ref.message.authorSnapshot as any) ?? ref.author ?? {
        id: ref.message.authorId, username: "Deleted User", displayName: null, avatar: null, status: "offline",
      };
      referencedMessages.set(ref.message.id, {
        id: ref.message.id, channelId: ref.message.channelId, author: refAuthor,
        content: ref.message.content, type: ref.message.type, flags: ref.message.flags,
        tts: ref.message.tts, mentionEveryone: ref.message.mentionEveryone,
        pinned: ref.message.pinned, editedTimestamp: ref.message.editedTimestamp?.toISOString() ?? null,
        referencedMessageId: ref.message.referencedMessageId, referencedMessage: null,
        webhookId: ref.message.webhookId, attachments: [], embeds: [], reactions: [],
        createdAt: ref.message.createdAt.toISOString(),
      });
    }
  }

  return messages.map((msg) => {
    const author = (msg.authorSnapshot as any) ?? {
      id: msg.authorId, username: "Deleted User", displayName: null, avatar: null, status: "offline",
    };

    return {
      id: msg.id, channelId: msg.channelId, author,
      content: msg.content, type: msg.type, flags: msg.flags, tts: msg.tts,
      mentionEveryone: msg.mentionEveryone, pinned: msg.pinned,
      editedTimestamp: msg.editedTimestamp?.toISOString() ?? null,
      referencedMessageId: msg.referencedMessageId,
      referencedMessage: msg.referencedMessageId ? referencedMessages.get(msg.referencedMessageId) ?? null : null,
      webhookId: msg.webhookId,
      attachments: attachmentsByMessage.get(msg.id) ?? [],
      embeds: [],
      reactions: reactionsByMessage.get(msg.id) ?? [],
      poll: pollsByMessage.get(msg.id) ?? undefined,
      createdAt: msg.createdAt.toISOString(),
    };
  });
}
