import { generateSnowflake } from "@yxc/snowflake";
import { redisPub } from "../config/redis.js";
import { auditlogRepository } from "../repositories/auditlog.repository.js";

export async function createAuditLogEntry(
  guildId: string,
  userId: string,
  actionType: number,
  targetId?: string,
  reason?: string,
  changes?: Record<string, { old?: unknown; new?: unknown }>
) {
  const id = generateSnowflake();

  await auditlogRepository.create({
    id,
    guildId,
    userId,
    actionType,
    targetId: targetId ?? null,
    reason: reason ?? null,
    changes: changes ? JSON.parse(JSON.stringify(changes)) : null,
  });

  const entry = await auditlogRepository.findById(id);

  // Dispatch GUILD_AUDIT_LOG_ENTRY_CREATE to guild members
  const alPayload = JSON.stringify({ event: "GUILD_AUDIT_LOG_ENTRY_CREATE", data: { ...entry!, createdAt: entry!.createdAt.toISOString() } });
  redisPub.publish(`gateway:guild:${guildId}`, alPayload).catch(() => {});

  return entry!;
}

export async function getAuditLog(
  guildId: string,
  options?: {
    userId?: string;
    actionType?: number;
    before?: string;
    limit?: number;
  }
) {
  const limit = Math.min(options?.limit ?? 50, 100);

  const entries = await auditlogRepository.findByGuildId(guildId, {
    userId: options?.userId,
    actionType: options?.actionType,
    limit,
  });

  return entries.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
  }));
}
