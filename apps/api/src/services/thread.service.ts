import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { ChannelType } from "@yxc/types";
import { threadRepository } from "../repositories/thread.repository.js";
import { channelRepository } from "../repositories/channel.repository.js";

export async function createThread(
  parentChannelId: string,
  name: string,
  creatorId: string,
  options?: {
    type?: number;
    autoArchiveDuration?: number;
    messageId?: string; // Create thread from message
  }
) {
  const parentChannel = await channelRepository.findById(parentChannelId);
  if (!parentChannel) throw new ApiError(404, "Parent channel not found");

  const threadId = generateSnowflake();
  const type = options?.type ?? ChannelType.PUBLIC_THREAD;

  await threadRepository.createThreadTransaction(
    {
      id: threadId,
      guildId: parentChannel.guildId,
      type,
      name,
      parentId: parentChannelId,
      ownerId: creatorId,
      position: 0,
    },
    {
      channelId: threadId,
      autoArchiveDuration: options?.autoArchiveDuration ?? 1440,
    },
    creatorId,
  );

  return getThread(threadId);
}

export async function getThread(threadId: string) {
  const channel = await threadRepository.findById(threadId);
  if (!channel) return null;

  const [metadata, members] = await Promise.all([
    threadRepository.findMetadata(threadId),
    threadRepository.findMembers(threadId),
  ]);

  return {
    ...channel,
    createdAt: channel.createdAt.toISOString(),
    threadMetadata: metadata
      ? {
          archived: metadata.archived,
          autoArchiveDuration: metadata.autoArchiveDuration,
          archiveTimestamp: metadata.archiveTimestamp?.toISOString() ?? null,
          locked: metadata.locked,
          invitable: metadata.invitable,
        }
      : null,
    memberCount: members.length,
  };
}

export async function updateThread(
  threadId: string,
  data: {
    name?: string;
    archived?: boolean;
    autoArchiveDuration?: number;
    locked?: boolean;
    invitable?: boolean;
  }
) {
  if (data.name) {
    await threadRepository.update(threadId, { name: data.name });
  }

  const metadataUpdate: Record<string, unknown> = {};
  if (data.archived !== undefined) {
    metadataUpdate.archived = data.archived;
    if (data.archived) metadataUpdate.archiveTimestamp = new Date();
  }
  if (data.autoArchiveDuration !== undefined) {
    metadataUpdate.autoArchiveDuration = data.autoArchiveDuration;
  }
  if (data.locked !== undefined) metadataUpdate.locked = data.locked;
  if (data.invitable !== undefined) metadataUpdate.invitable = data.invitable;

  if (Object.keys(metadataUpdate).length > 0) {
    await threadRepository.updateMetadata(threadId, metadataUpdate);
  }

  return getThread(threadId);
}

export async function deleteThread(threadId: string) {
  await threadRepository.deleteThread(threadId);
}

export async function addThreadMember(threadId: string, userId: string) {
  await threadRepository.addMember(threadId, userId);
}

export async function removeThreadMember(threadId: string, userId: string) {
  await threadRepository.removeMember(threadId, userId);
}

export async function getThreadMembers(threadId: string) {
  const members = await threadRepository.findMembers(threadId);

  return members.map((m) => ({
    ...m,
    joinTimestamp: m.joinTimestamp.toISOString(),
  }));
}

export async function getActiveThreads(guildId: string) {
  const allChannels = await channelRepository.findByGuildId(guildId);

  const threadTypes = [
    ChannelType.PUBLIC_THREAD,
    ChannelType.PRIVATE_THREAD,
    ChannelType.ANNOUNCEMENT_THREAD,
  ];

  const threads = [];
  for (const ch of allChannels) {
    if (!threadTypes.includes(ch.type)) continue;

    const metadata = await threadRepository.findMetadata(ch.id);
    if (metadata?.archived) continue;

    threads.push({
      ...ch,
      createdAt: ch.createdAt.toISOString(),
      threadMetadata: metadata
        ? {
            archived: metadata.archived,
            autoArchiveDuration: metadata.autoArchiveDuration,
            archiveTimestamp: metadata.archiveTimestamp?.toISOString() ?? null,
            locked: metadata.locked,
            invitable: metadata.invitable,
          }
        : null,
    });
  }

  return threads;
}
