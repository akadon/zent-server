import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import * as channelService from "./channel.service.js";
import * as webhookService from "./webhook.service.js";
import { channelFollowRepository } from "../repositories/channel-follow.repository.js";

export interface ChannelFollower {
  id: string;
  channelId: string;
  webhookId: string;
  guildId: string;
  createdAt: Date;
}

// Follow an announcement channel
export async function followChannel(
  sourceChannelId: string,
  targetChannelId: string,
  userId: string
): Promise<ChannelFollower> {
  // Verify source channel is an announcement channel
  const sourceChannel = await channelService.getChannel(sourceChannelId);
  if (!sourceChannel) {
    throw new ApiError(404, "Source channel not found");
  }
  if (sourceChannel.type !== 5) { // GUILD_ANNOUNCEMENT
    throw new ApiError(400, "Can only follow announcement channels");
  }

  // Verify target channel exists and is a text channel
  const targetChannel = await channelService.getChannel(targetChannelId);
  if (!targetChannel) {
    throw new ApiError(404, "Target channel not found");
  }
  if (!targetChannel.guildId) {
    throw new ApiError(400, "Target channel must be in a guild");
  }

  // Create a webhook in the target channel
  const webhook = await webhookService.createWebhook(
    targetChannel.guildId,
    targetChannelId,
    userId,
    `${sourceChannel.name ?? "Announcements"} Follow`,
    undefined
  );

  // Create follower record
  const id = generateSnowflake();
  const follower = await channelFollowRepository.create({
    id,
    channelId: sourceChannelId,
    webhookId: webhook.id,
    guildId: targetChannel.guildId,
  });

  if (!follower) {
    throw new ApiError(500, "Failed to create channel follower");
  }

  return follower;
}

// Unfollow an announcement channel
export async function unfollowChannel(
  sourceChannelId: string,
  webhookId: string
): Promise<void> {
  const follower = await channelFollowRepository.findByChannelAndWebhook(sourceChannelId, webhookId);

  if (!follower) {
    throw new ApiError(404, "Follower not found");
  }

  // Delete the webhook
  await webhookService.deleteWebhook(webhookId);

  // Delete the follower record
  await channelFollowRepository.delete(follower.id);
}

// Get all followers of a channel
export async function getChannelFollowers(channelId: string): Promise<ChannelFollower[]> {
  return await channelFollowRepository.findByChannelId(channelId);
}

// Crosspost a message to all followers
export async function crosspostMessage(
  channelId: string,
  messageId: string,
  content: string,
  authorUsername: string,
  authorAvatarUrl?: string
): Promise<number> {
  const followers = await getChannelFollowers(channelId);
  let successCount = 0;

  for (const follower of followers) {
    try {
      // Get the webhook
      const webhook = await webhookService.getWebhook(follower.webhookId);
      if (!webhook?.token) continue;

      // Execute the webhook
      await webhookService.executeWebhook(webhook.id, webhook.token, content, {
        username: authorUsername,
        avatarUrl: authorAvatarUrl,
      });

      successCount++;
    } catch (error) {
      // Log error but continue with other followers
      console.error(`Failed to crosspost to webhook ${follower.webhookId}:`, error);
    }
  }

  return successCount;
}

// Get followers for a webhook (for deletion cleanup)
export async function getFollowerByWebhook(webhookId: string): Promise<ChannelFollower | null> {
  return channelFollowRepository.findByWebhookId(webhookId);
}
