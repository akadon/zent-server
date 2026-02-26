import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import crypto from "crypto";
import { webhookRepository } from "../repositories/webhook.repository.js";
import { messageRepository } from "../repositories/message.repository.js";

function generateWebhookToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createWebhook(
  guildId: string,
  channelId: string,
  creatorId: string,
  name: string,
  avatar?: string
) {
  const id = generateSnowflake();
  const token = generateWebhookToken();

  return webhookRepository.create({
    id,
    guildId,
    channelId,
    creatorId,
    name: name || "Captain Hook",
    avatar: avatar ?? null,
    token,
    type: 1,
  });
}

export async function getWebhook(webhookId: string) {
  const webhook = await webhookRepository.findById(webhookId);
  if (!webhook) throw new ApiError(404, "Webhook not found");
  return webhook;
}

export async function getChannelWebhooks(channelId: string) {
  return webhookRepository.findByChannelId(channelId);
}

export async function getGuildWebhooks(guildId: string) {
  return webhookRepository.findByGuildId(guildId);
}

export async function updateWebhook(
  webhookId: string,
  data: { name?: string; avatar?: string | null; channelId?: string }
) {
  const updated = await webhookRepository.update(webhookId, data);
  if (!updated) throw new ApiError(404, "Webhook not found");
  return updated;
}

export async function deleteWebhook(webhookId: string) {
  const existing = await webhookRepository.findById(webhookId);
  if (!existing) throw new ApiError(404, "Webhook not found");
  await webhookRepository.delete(webhookId);
}

export async function executeWebhook(
  webhookId: string,
  token: string,
  content: string,
  options?: { username?: string; avatarUrl?: string; tts?: boolean }
) {
  const webhook = await webhookRepository.findById(webhookId);

  if (!webhook || webhook.token !== token)
    throw new ApiError(404, "Webhook not found or invalid token");

  const id = generateSnowflake();

  const message = await messageRepository.create({
    id,
    channelId: webhook.channelId,
    authorId: webhook.id,
    content,
    type: 0,
    tts: options?.tts ?? false,
    webhookId: webhook.id,
  });

  // Update channel last message
  await messageRepository.updateLastMessageId(webhook.channelId, id);

  return {
    id: message.id,
    channelId: message.channelId,
    content: message.content,
    webhookId: webhook.id,
    author: {
      id: webhook.id,
      username: options?.username ?? webhook.name,
      avatar: options?.avatarUrl ?? webhook.avatar,
      bot: true,
    },
    createdAt: message.createdAt.toISOString(),
  };
}
