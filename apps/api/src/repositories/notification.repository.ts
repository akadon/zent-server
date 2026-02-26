import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const notificationRepository = {
  async findById(id: string) {
    const [notif] = await db.select().from(schema.notificationLog).where(eq(schema.notificationLog.id, id)).limit(1);
    return notif ?? null;
  },
  async findByUserId(userId: string, opts?: { limit?: number }) {
    const limit = opts?.limit ?? 50;
    return db.select().from(schema.notificationLog)
      .where(eq(schema.notificationLog.userId, userId))
      .orderBy(desc(schema.notificationLog.createdAt))
      .limit(limit);
  },
  async create(data: {
    id: string;
    userId: string;
    type: string;
    sourceGuildId?: string | null;
    sourceChannelId?: string | null;
    sourceMessageId?: string | null;
    sourceUserId?: string | null;
    title: string;
    body?: string | null;
  }) {
    await db.insert(schema.notificationLog).values(data);
  },
  async markRead(id: string, userId: string) {
    await db
      .update(schema.notificationLog)
      .set({ read: true })
      .where(and(eq(schema.notificationLog.id, id), eq(schema.notificationLog.userId, userId)));
  },
  async markAllRead(userId: string) {
    await db
      .update(schema.notificationLog)
      .set({ read: true })
      .where(eq(schema.notificationLog.userId, userId));
  },
  async deleteAll(userId: string) {
    await db.delete(schema.notificationLog).where(eq(schema.notificationLog.userId, userId));
  },
};
