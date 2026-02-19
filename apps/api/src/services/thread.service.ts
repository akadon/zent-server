import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { ChannelType } from "@yxc/types";

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
  const parentChannel = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, parentChannelId))
    .limit(1);

  if (!parentChannel[0]) throw new ApiError(404, "Parent channel not found");

  const threadId = generateSnowflake();
  const type = options?.type ?? ChannelType.PUBLIC_THREAD;

  await db.transaction(async (tx) => {
    // Create thread as a channel
    await tx.insert(schema.channels).values({
      id: threadId,
      guildId: parentChannel[0]!.guildId,
      type,
      name,
      parentId: parentChannelId,
      ownerId: creatorId,
      position: 0,
    });

    // Create thread metadata
    await tx.insert(schema.threadMetadata).values({
      channelId: threadId,
      autoArchiveDuration: options?.autoArchiveDuration ?? 1440,
    });

    // Add creator as thread member
    await tx.insert(schema.threadMembers).values({
      channelId: threadId,
      userId: creatorId,
    });
  });

  return getThread(threadId);
}

export async function getThread(threadId: string) {
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, threadId))
    .limit(1);

  if (!channel) return null;

  const [metadata] = await db
    .select()
    .from(schema.threadMetadata)
    .where(eq(schema.threadMetadata.channelId, threadId))
    .limit(1);

  const memberCount = await db
    .select({ userId: schema.threadMembers.userId })
    .from(schema.threadMembers)
    .where(eq(schema.threadMembers.channelId, threadId));

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
    memberCount: memberCount.length,
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
    await db
      .update(schema.channels)
      .set({ name: data.name })
      .where(eq(schema.channels.id, threadId));
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
    await db
      .update(schema.threadMetadata)
      .set(metadataUpdate)
      .where(eq(schema.threadMetadata.channelId, threadId));
  }

  return getThread(threadId);
}

export async function deleteThread(threadId: string) {
  await db.delete(schema.threadMembers).where(eq(schema.threadMembers.channelId, threadId));
  await db.delete(schema.threadMetadata).where(eq(schema.threadMetadata.channelId, threadId));
  await db.delete(schema.channels).where(eq(schema.channels.id, threadId));
}

export async function addThreadMember(threadId: string, userId: string) {
  await db
    .insert(schema.threadMembers)
    .values({ channelId: threadId, userId })
    .onDuplicateKeyUpdate({ set: { channelId: sql`channel_id` } });
}

export async function removeThreadMember(threadId: string, userId: string) {
  await db
    .delete(schema.threadMembers)
    .where(
      and(
        eq(schema.threadMembers.channelId, threadId),
        eq(schema.threadMembers.userId, userId)
      )
    );
}

export async function getThreadMembers(threadId: string) {
  const members = await db
    .select()
    .from(schema.threadMembers)
    .where(eq(schema.threadMembers.channelId, threadId));

  return members.map((m) => ({
    ...m,
    joinTimestamp: m.joinTimestamp.toISOString(),
  }));
}

export async function getActiveThreads(guildId: string) {
  const allThreads = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.guildId, guildId));

  const threadTypes = [
    ChannelType.PUBLIC_THREAD,
    ChannelType.PRIVATE_THREAD,
    ChannelType.ANNOUNCEMENT_THREAD,
  ];

  const threads = [];
  for (const ch of allThreads) {
    if (!threadTypes.includes(ch.type)) continue;

    const [metadata] = await db
      .select()
      .from(schema.threadMetadata)
      .where(eq(schema.threadMetadata.channelId, ch.id))
      .limit(1);

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
