import { eq, and, desc, sql, gte } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const moderationQueueRepository = {
  async findById(id: string) {
    const [item] = await db.select().from(schema.moderationQueue).where(eq(schema.moderationQueue.id, id)).limit(1);
    return item ?? null;
  },
  async findByGuildId(guildId: string, status?: string) {
    return db.select().from(schema.moderationQueue)
      .where(
        status
          ? and(eq(schema.moderationQueue.guildId, guildId), eq(schema.moderationQueue.status, status as any))
          : eq(schema.moderationQueue.guildId, guildId)
      )
      .orderBy(desc(schema.moderationQueue.createdAt))
      .limit(100);
  },
  async create(data: { id: string; guildId: string; type: string; targetId: string; reason: string; reportedBy: string }) {
    await db.insert(schema.moderationQueue).values(data);
    const [created] = await db.select().from(schema.moderationQueue).where(eq(schema.moderationQueue.id, data.id)).limit(1);
    return created!;
  },
  async resolve(id: string, data: { status: string; moderatorId: string; moderatorNote: string | null }) {
    await db.update(schema.moderationQueue).set({
      status: data.status as any,
      moderatorId: data.moderatorId,
      moderatorNote: data.moderatorNote,
      resolvedAt: new Date(),
    }).where(eq(schema.moderationQueue.id, id));
    const [updated] = await db.select().from(schema.moderationQueue).where(eq(schema.moderationQueue.id, id)).limit(1);
    return updated!;
  },
  async countByModeratorInGuild(guildId: string) {
    return db.select({
      moderatorId: schema.moderationQueue.moderatorId,
      count: sql<number>`count(*)`,
    }).from(schema.moderationQueue)
      .where(and(
        eq(schema.moderationQueue.guildId, guildId),
        sql`${schema.moderationQueue.moderatorId} IS NOT NULL`,
      ))
      .groupBy(schema.moderationQueue.moderatorId);
  },
  async countByStatusInGuild(guildId: string) {
    return db.select({
      status: schema.moderationQueue.status,
      count: sql<number>`count(*)`,
    }).from(schema.moderationQueue)
      .where(eq(schema.moderationQueue.guildId, guildId))
      .groupBy(schema.moderationQueue.status);
  },
  async countByTypeInGuild(guildId: string) {
    return db.select({
      type: schema.moderationQueue.type,
      count: sql<number>`count(*)`,
    }).from(schema.moderationQueue)
      .where(eq(schema.moderationQueue.guildId, guildId))
      .groupBy(schema.moderationQueue.type);
  },
  async countRecentInGuild(guildId: string, since: Date) {
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(schema.moderationQueue)
      .where(and(
        eq(schema.moderationQueue.guildId, guildId),
        gte(schema.moderationQueue.createdAt, since),
      ));
    return result?.count ?? 0;
  },
};
