import { eq } from "drizzle-orm";
import { db, schema, SerializedGuild } from "../db/index.js";

export const guildTemplateRepository = {
  async findByCode(code: string) {
    const [template] = await db.select().from(schema.guildTemplates).where(eq(schema.guildTemplates.code, code)).limit(1);
    return template ?? null;
  },
  async findByGuildId(guildId: string) {
    const [template] = await db.select().from(schema.guildTemplates).where(eq(schema.guildTemplates.guildId, guildId)).limit(1);
    return template ?? null;
  },
  async create(data: {
    code: string;
    guildId: string;
    name: string;
    description: string | null;
    creatorId: string;
    serializedGuild: SerializedGuild;
  }) {
    await db.insert(schema.guildTemplates).values(data);
    const [created] = await db.select().from(schema.guildTemplates).where(eq(schema.guildTemplates.code, data.code)).limit(1);
    return created!;
  },
  async update(code: string, data: Record<string, any>) {
    await db.update(schema.guildTemplates).set({ ...data, updatedAt: new Date() }).where(eq(schema.guildTemplates.code, code));
    const [updated] = await db.select().from(schema.guildTemplates).where(eq(schema.guildTemplates.code, code)).limit(1);
    return updated!;
  },
  async delete(code: string) {
    await db.delete(schema.guildTemplates).where(eq(schema.guildTemplates.code, code));
  },
  async incrementUsageCount(code: string, currentCount: number) {
    await db.update(schema.guildTemplates).set({ usageCount: currentCount + 1 }).where(eq(schema.guildTemplates.code, code));
  },
};
