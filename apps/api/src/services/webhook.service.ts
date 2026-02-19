import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { createMessage } from "./message.service.js";
import crypto from "crypto";

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

  await db
    .insert(schema.webhooks)
    .values({
      id,
      guildId,
      channelId,
      creatorId,
      name: name || "Captain Hook",
      avatar: avatar ?? null,
      token,
      type: 1,
    });

  const [webhook] = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, id))
    .limit(1);

  return webhook!;
}

export async function getWebhook(webhookId: string) {
  const [webhook] = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .limit(1);

  if (!webhook) throw new ApiError(404, "Webhook not found");
  return webhook;
}

export async function getChannelWebhooks(channelId: string) {
  return db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.channelId, channelId));
}

export async function getGuildWebhooks(guildId: string) {
  return db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.guildId, guildId));
}

export async function updateWebhook(
  webhookId: string,
  data: { name?: string; avatar?: string | null; channelId?: string }
) {
  await db
    .update(schema.webhooks)
    .set(data)
    .where(eq(schema.webhooks.id, webhookId));

  const [updated] = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .limit(1);

  if (!updated) throw new ApiError(404, "Webhook not found");
  return updated;
}

export async function deleteWebhook(webhookId: string) {
  const [existing] = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .limit(1);

  if (!existing) throw new ApiError(404, "Webhook not found");

  await db
    .delete(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId));
}

export async function executeWebhook(
  webhookId: string,
  token: string,
  content: string,
  options?: { username?: string; avatarUrl?: string; tts?: boolean }
) {
  const [webhook] = await db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.id, webhookId), eq(schema.webhooks.token, token)))
    .limit(1);

  if (!webhook) throw new ApiError(404, "Webhook not found or invalid token");

  const id = generateSnowflake();

  await db
    .insert(schema.messages)
    .values({
      id,
      channelId: webhook.channelId,
      authorId: webhook.id,
      content,
      type: 0,
      tts: options?.tts ?? false,
      webhookId: webhook.id,
    });

  const [message] = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, id))
    .limit(1);

  // Update channel last message
  await db
    .update(schema.channels)
    .set({ lastMessageId: id })
    .where(eq(schema.channels.id, webhook.channelId));

  return {
    id: message!.id,
    channelId: message!.channelId,
    content: message!.content,
    webhookId: webhook.id,
    author: {
      id: webhook.id,
      username: options?.username ?? webhook.name,
      avatar: options?.avatarUrl ?? webhook.avatar,
      bot: true,
    },
    createdAt: message!.createdAt.toISOString(),
  };
}
