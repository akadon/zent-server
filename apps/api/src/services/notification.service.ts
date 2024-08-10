import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";

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
  const [notif] = await db
    .insert(schema.notificationLog)
    .values({
      id,
      userId,
      type,
      title,
      body: opts?.body ?? null,
      sourceGuildId: opts?.sourceGuildId ?? null,
      sourceChannelId: opts?.sourceChannelId ?? null,
      sourceMessageId: opts?.sourceMessageId ?? null,
      sourceUserId: opts?.sourceUserId ?? null,
    })
    .returning();

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

  let query = db
    .select()
    .from(schema.notificationLog)
    .where(eq(schema.notificationLog.userId, userId))
    .orderBy(desc(schema.notificationLog.createdAt))
    .limit(limit);

  const results = await query;

  return results.map((n) => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function markNotificationRead(id: string, userId: string) {
  await db
    .update(schema.notificationLog)
    .set({ read: true })
    .where(and(eq(schema.notificationLog.id, id), eq(schema.notificationLog.userId, userId)));
}

export async function markAllNotificationsRead(userId: string) {
  await db
    .update(schema.notificationLog)
    .set({ read: true })
    .where(and(eq(schema.notificationLog.userId, userId), eq(schema.notificationLog.read, false)));
}

export async function clearNotifications(userId: string) {
  await db
    .delete(schema.notificationLog)
    .where(eq(schema.notificationLog.userId, userId));
}
