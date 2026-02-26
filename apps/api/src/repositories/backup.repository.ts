import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const backupRepository = {
  async findById(id: string) {
    const [backup] = await db.select().from(schema.serverBackups).where(eq(schema.serverBackups.id, id)).limit(1);
    return backup ?? null;
  },
  async findByGuildId(guildId: string) {
    return db.select({
      id: schema.serverBackups.id,
      guildId: schema.serverBackups.guildId,
      createdBy: schema.serverBackups.createdBy,
      createdAt: schema.serverBackups.createdAt,
    }).from(schema.serverBackups)
      .where(eq(schema.serverBackups.guildId, guildId))
      .orderBy(desc(schema.serverBackups.createdAt));
  },
  async create(data: { id: string; guildId: string; createdBy: string; data: any }) {
    await db.insert(schema.serverBackups).values(data);
    const [created] = await db.select().from(schema.serverBackups).where(eq(schema.serverBackups.id, data.id)).limit(1);
    return created!;
  },
  async delete(id: string) {
    await db.delete(schema.serverBackups).where(eq(schema.serverBackups.id, id));
  },
};
