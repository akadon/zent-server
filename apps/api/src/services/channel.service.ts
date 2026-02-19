import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import type { CreateChannelRequest, UpdateChannelRequest } from "@yxc/types";

export async function createChannel(guildId: string, data: CreateChannelRequest) {
  const id = generateSnowflake();

  await db
    .insert(schema.channels)
    .values({
      id,
      guildId,
      type: data.type,
      name: data.name,
      topic: data.topic ?? null,
      parentId: data.parentId ?? null,
      nsfw: data.nsfw ?? false,
      rateLimitPerUser: data.rateLimitPerUser ?? 0,
      bitrate: data.bitrate ?? null,
      userLimit: data.userLimit ?? null,
      position: data.position ?? 0,
    });

  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, id))
    .limit(1);

  return {
    ...channel!,
    createdAt: channel!.createdAt.toISOString(),
  };
}

export async function getChannel(channelId: string) {
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);

  if (!channel) return null;
  return { ...channel, createdAt: channel.createdAt.toISOString() };
}

export async function getGuildChannels(guildId: string) {
  const channelList = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.guildId, guildId));

  return channelList.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function updateChannel(channelId: string, data: UpdateChannelRequest) {
  await db
    .update(schema.channels)
    .set(data)
    .where(eq(schema.channels.id, channelId));

  const [updated] = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);

  if (!updated) throw new ApiError(404, "Channel not found");
  return { ...updated, createdAt: updated.createdAt.toISOString() };
}

export async function deleteChannel(channelId: string) {
  const [deleted] = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);

  if (!deleted) throw new ApiError(404, "Channel not found");

  await db
    .delete(schema.channels)
    .where(eq(schema.channels.id, channelId));

  return { ...deleted, createdAt: deleted.createdAt.toISOString() };
}
