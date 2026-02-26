import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import type { CreateChannelRequest, UpdateChannelRequest } from "@yxc/types";
import { channelRepository } from "../repositories/channel.repository.js";

export async function createChannel(guildId: string, data: CreateChannelRequest) {
  const id = generateSnowflake();

  const channel = await channelRepository.create({
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

  return {
    ...channel,
    createdAt: channel.createdAt.toISOString(),
  };
}

export async function getChannel(channelId: string) {
  const channel = await channelRepository.findById(channelId);
  if (!channel) return null;
  return { ...channel, createdAt: channel.createdAt.toISOString() };
}

export async function getGuildChannels(guildId: string) {
  const channelList = await channelRepository.findByGuildId(guildId);

  return channelList.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function updateChannel(channelId: string, data: UpdateChannelRequest) {
  const updated = await channelRepository.update(channelId, data);
  if (!updated) throw new ApiError(404, "Channel not found");
  return { ...updated, createdAt: updated.createdAt.toISOString() };
}

export async function deleteChannel(channelId: string) {
  const channel = await channelRepository.findById(channelId);
  if (!channel) throw new ApiError(404, "Channel not found");

  await channelRepository.delete(channelId);

  return { ...channel, createdAt: channel.createdAt.toISOString() };
}
