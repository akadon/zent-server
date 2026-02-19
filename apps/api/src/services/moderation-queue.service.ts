import { eq, and, desc, sql, gte } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

export async function createQueueItem(
  guildId: string,
  type: string,
  targetId: string,
  reason: string,
  reportedBy: string
) {
  const id = generateSnowflake();
  await db
    .insert(schema.moderationQueue)
    .values({ id, guildId, type, targetId, reason, reportedBy });

  const [item] = await db
    .select()
    .from(schema.moderationQueue)
    .where(eq(schema.moderationQueue.id, id))
    .limit(1);

  return {
    ...item!,
    createdAt: item!.createdAt.toISOString(),
    resolvedAt: item!.resolvedAt?.toISOString() ?? null,
  };
}

export async function getQueueItems(guildId: string, status?: string) {
  let query = db
    .select()
    .from(schema.moderationQueue)
    .where(
      status
        ? and(eq(schema.moderationQueue.guildId, guildId), eq(schema.moderationQueue.status, status as any))
        : eq(schema.moderationQueue.guildId, guildId)
    )
    .orderBy(desc(schema.moderationQueue.createdAt))
    .limit(100);

  const items = await query;
  return items.map((i) => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
  }));
}

export async function resolveQueueItem(
  itemId: string,
  moderatorId: string,
  action: string,
  note?: string
) {
  const [item] = await db
    .select()
    .from(schema.moderationQueue)
    .where(eq(schema.moderationQueue.id, itemId))
    .limit(1);

  if (!item) throw new ApiError(404, "Queue item not found");
  if (item.status !== "pending") throw new ApiError(400, "Item already resolved");

  await db
    .update(schema.moderationQueue)
    .set({
      status: action as any,
      moderatorId,
      moderatorNote: note ?? null,
      resolvedAt: new Date(),
    })
    .where(eq(schema.moderationQueue.id, itemId));

  const [updated] = await db
    .select()
    .from(schema.moderationQueue)
    .where(eq(schema.moderationQueue.id, itemId))
    .limit(1);

  return {
    ...updated!,
    createdAt: updated!.createdAt.toISOString(),
    resolvedAt: updated!.resolvedAt?.toISOString() ?? null,
  };
}

export async function getModeratorAnalytics(guildId: string) {
  // Actions per moderator
  const modActions = await db
    .select({
      moderatorId: schema.moderationQueue.moderatorId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.moderationQueue)
    .where(
      and(
        eq(schema.moderationQueue.guildId, guildId),
        sql`${schema.moderationQueue.moderatorId} IS NOT NULL`
      )
    )
    .groupBy(schema.moderationQueue.moderatorId);

  // Items by status
  const statusCounts = await db
    .select({
      status: schema.moderationQueue.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.moderationQueue)
    .where(eq(schema.moderationQueue.guildId, guildId))
    .groupBy(schema.moderationQueue.status);

  // Items by type
  const typeCounts = await db
    .select({
      type: schema.moderationQueue.type,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.moderationQueue)
    .where(eq(schema.moderationQueue.guildId, guildId))
    .groupBy(schema.moderationQueue.type);

  // Recent activity (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentItems = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.moderationQueue)
    .where(
      and(
        eq(schema.moderationQueue.guildId, guildId),
        gte(schema.moderationQueue.createdAt, sevenDaysAgo)
      )
    );

  return {
    moderatorActions: modActions,
    statusBreakdown: statusCounts,
    typeBreakdown: typeCounts,
    recentItemCount: recentItems[0]?.count ?? 0,
  };
}
