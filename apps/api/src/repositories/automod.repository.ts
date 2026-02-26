import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const automodRepository = {
  async findByGuildId(guildId: string) {
    const [config] = await db
      .select()
      .from(schema.automodConfig)
      .where(eq(schema.automodConfig.guildId, guildId))
      .limit(1);
    return config ?? null;
  },
  async update(
    guildId: string,
    data: Partial<{
      enabled: boolean;
      keywordFilters: { enabled: boolean; blockedWords: string[]; action: "delete" | "warn" | "timeout" };
      mentionSpam: { enabled: boolean; maxMentions: number; action: "delete" | "warn" | "timeout" };
      linkFilter: { enabled: boolean; blockAllLinks: boolean; whitelist: string[]; action: "delete" | "warn" | "timeout" };
      antiRaid: { enabled: boolean; joinRateLimit: number; joinRateWindow: number; action: "lockdown" | "kick" | "notify" };
    }>,
  ) {
    await db
      .insert(schema.automodConfig)
      .values({ guildId, ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.automodConfig.guildId,
        set: { ...data, updatedAt: new Date() },
      });
    return (await db.select().from(schema.automodConfig).where(eq(schema.automodConfig.guildId, guildId)).limit(1))[0]!;
  },
  async delete(guildId: string) {
    await db.delete(schema.automodConfig).where(eq(schema.automodConfig.guildId, guildId));
  },
};
