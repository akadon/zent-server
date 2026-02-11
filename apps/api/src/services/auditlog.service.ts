import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";

export async function createAuditLogEntry(
  guildId: string,
  userId: string,
  actionType: number,
  targetId?: string,
  reason?: string,
  changes?: Record<string, { old?: unknown; new?: unknown }>
) {
  const id = generateSnowflake();

  const [entry] = await db
    .insert(schema.auditLogEntries)
    .values({
      id,
      guildId,
      userId,
      actionType,
      targetId: targetId ?? null,
      reason: reason ?? null,
      changes: changes ? JSON.parse(JSON.stringify(changes)) : null,
    })
    .returning();

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

  // Build conditions
  const conditions = [eq(schema.auditLogEntries.guildId, guildId)];

  if (options?.userId) {
    conditions.push(eq(schema.auditLogEntries.userId, options.userId));
  }
  if (options?.actionType !== undefined) {
    conditions.push(eq(schema.auditLogEntries.actionType, options.actionType));
  }

  const entries = await db
    .select()
    .from(schema.auditLogEntries)
    .where(and(...conditions))
    .orderBy(desc(schema.auditLogEntries.createdAt))
    .limit(limit);

  return entries.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
  }));
}
