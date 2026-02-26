import { generateSnowflake } from "@yxc/snowflake";
import { notificationRepository } from "../repositories/notification.repository.js";

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  opts?: {
    body?: string;
    sourceGuildId?: string;
    sourceChannelId?: string;
    sourceMessageId?: string;
    sourceUserId?: string;
  }
) {
  const id = generateSnowflake();
  await notificationRepository.create({
    id,
    userId,
    type,
    title,
    body: opts?.body ?? null,
    sourceGuildId: opts?.sourceGuildId ?? null,
    sourceChannelId: opts?.sourceChannelId ?? null,
    sourceMessageId: opts?.sourceMessageId ?? null,
    sourceUserId: opts?.sourceUserId ?? null,
  });

  const notif = await notificationRepository.findById(id);

  return {
    ...notif!,
    createdAt: notif!.createdAt.toISOString(),
  };
}

export async function getNotifications(
  userId: string,
  opts?: { type?: string; limit?: number; before?: string }
) {
  const limit = opts?.limit ?? 50;

  const results = await notificationRepository.findByUserId(userId, { limit });

  return results.map((n) => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function markNotificationRead(id: string, userId: string) {
  await notificationRepository.markRead(id, userId);
}

export async function markAllNotificationsRead(userId: string) {
  await notificationRepository.markAllRead(userId);
}

export async function clearNotifications(userId: string) {
  await notificationRepository.deleteAll(userId);
}
