import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { moderationQueueRepository } from "../repositories/moderation-queue.repository.js";

export async function createQueueItem(
  guildId: string,
  type: string,
  targetId: string,
  reason: string,
  reportedBy: string
) {
  const id = generateSnowflake();
  const item = await moderationQueueRepository.create({ id, guildId, type, targetId, reason, reportedBy });

  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
  };
}

export async function getQueueItems(guildId: string, status?: string) {
  const items = await moderationQueueRepository.findByGuildId(guildId, status);
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
  const item = await moderationQueueRepository.findById(itemId);
  if (!item) throw new ApiError(404, "Queue item not found");
  if (item.status !== "pending") throw new ApiError(400, "Item already resolved");

  const updated = await moderationQueueRepository.resolve(itemId, {
    status: action,
    moderatorId,
    moderatorNote: note ?? null,
  });

  return {
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    resolvedAt: updated.resolvedAt?.toISOString() ?? null,
  };
}

export async function getModeratorAnalytics(guildId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [modActions, statusCounts, typeCounts, recentItemCount] = await Promise.all([
    moderationQueueRepository.countByModeratorInGuild(guildId),
    moderationQueueRepository.countByStatusInGuild(guildId),
    moderationQueueRepository.countByTypeInGuild(guildId),
    moderationQueueRepository.countRecentInGuild(guildId, sevenDaysAgo),
  ]);

  return {
    moderatorActions: modActions,
    statusBreakdown: statusCounts,
    typeBreakdown: typeCounts,
    recentItemCount,
  };
}
