import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { banAppealRepository } from "../repositories/ban-appeal.repository.js";
import { memberRepository } from "../repositories/member.repository.js";
import { guildRepository } from "../repositories/guild.repository.js";

export async function createBanAppeal(guildId: string, userId: string, reason: string) {
  // Verify user is actually banned
  const ban = await memberRepository.findBan(userId, guildId);
  if (!ban) throw new ApiError(400, "You are not banned from this guild");

  // Check for existing pending appeal
  const existing = await banAppealRepository.findPendingByUserAndGuild(userId, guildId);
  if (existing) throw new ApiError(400, "You already have a pending appeal");

  const id = generateSnowflake();
  const appeal = await banAppealRepository.create({ id, guildId, userId, reason });

  return {
    ...appeal,
    createdAt: appeal.createdAt.toISOString(),
    resolvedAt: appeal.resolvedAt?.toISOString() ?? null,
  };
}

export async function getGuildAppeals(guildId: string) {
  const appeals = await banAppealRepository.findByGuildId(guildId);

  return appeals.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
  }));
}

export async function resolveAppeal(
  appealId: string,
  moderatorId: string,
  status: "accepted" | "rejected",
  moderatorReason?: string
) {
  const appeal = await banAppealRepository.findById(appealId);
  if (!appeal) throw new ApiError(404, "Appeal not found");
  if (appeal.status !== "pending") throw new ApiError(400, "Appeal already resolved");

  // Verify moderator is guild owner (simplified check)
  const guild = await guildRepository.findOwnerById(appeal.guildId);
  if (!guild || guild.ownerId !== moderatorId) {
    throw new ApiError(403, "Missing permissions");
  }

  const updated = await banAppealRepository.resolve(appealId, {
    status,
    moderatorId,
    moderatorReason: moderatorReason ?? null,
  });

  // If accepted, remove the ban
  if (status === "accepted") {
    await memberRepository.deleteBan(appeal.userId, appeal.guildId);
  }

  return {
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    resolvedAt: updated.resolvedAt?.toISOString() ?? null,
  };
}
