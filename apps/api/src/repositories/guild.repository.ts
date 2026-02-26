import { eq, and, inArray, count } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const guildRepository = {
  async findById(id: string) {
    const [guild] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, id)).limit(1);
    return guild ?? null;
  },
  async findOwnerById(id: string) {
    const [guild] = await db.select({ ownerId: schema.guilds.ownerId }).from(schema.guilds).where(eq(schema.guilds.id, id)).limit(1);
    return guild ?? null;
  },
  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return db.select().from(schema.guilds).where(inArray(schema.guilds.id, ids));
  },
  async create(tx: any, data: { id: string; name: string; icon?: string | null; ownerId: string; systemChannelId?: string }) {
    await tx.insert(schema.guilds).values(data);
  },
  async update(id: string, data: Record<string, any>) {
    await db.update(schema.guilds).set({ ...data, updatedAt: new Date() }).where(eq(schema.guilds.id, id));
    const [updated] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, id)).limit(1);
    return updated!;
  },
  async delete(id: string) {
    await db.delete(schema.guilds).where(eq(schema.guilds.id, id));
  },
  async getMemberCount(guildId: string) {
    const [result] = await db.select({ count: count() }).from(schema.members).where(eq(schema.members.guildId, guildId));
    return result?.count ?? 0;
  },
  transaction: db.transaction.bind(db),
};
