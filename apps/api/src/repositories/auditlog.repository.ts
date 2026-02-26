import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const auditlogRepository = {
  async findById(id: string) {
    const [entry] = await db.select().from(schema.auditLogEntries).where(eq(schema.auditLogEntries.id, id)).limit(1);
    return entry ?? null;
  },
  async create(data: {
    id: string;
    guildId: string;
    userId?: string | null;
    targetId?: string | null;
    actionType: number;
    reason?: string | null;
    changes?: unknown;
  }) {
    await db.insert(schema.auditLogEntries).values(data);
  },
  async findByGuildId(
    guildId: string,
    filters?: { userId?: string; actionType?: number; limit?: number },
  ) {
    const conditions = [eq(schema.auditLogEntries.guildId, guildId)];
    if (filters?.userId) {
      conditions.push(eq(schema.auditLogEntries.userId, filters.userId));
    }
    if (filters?.actionType !== undefined) {
      conditions.push(eq(schema.auditLogEntries.actionType, filters.actionType));
    }
    const limit = filters?.limit ?? 50;
    return db
      .select()
      .from(schema.auditLogEntries)
      .where(and(...conditions))
      .orderBy(desc(schema.auditLogEntries.createdAt))
      .limit(limit);
  },
};
