import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const notificationSettingsRepository = {
  async find(userId: string, guildId?: string, channelId?: string) {
    const conditions = [eq(schema.notificationSettings.userId, userId)];
    if (guildId) conditions.push(eq(schema.notificationSettings.guildId, guildId));
    if (channelId) conditions.push(eq(schema.notificationSettings.channelId, channelId));
    return db.select().from(schema.notificationSettings).where(and(...conditions));
  },
  async upsert(
    userId: string,
    guildId: string,
    channelId: string,
    values: Record<string, any>,
    setClause: Record<string, any>,
  ) {
    await db.insert(schema.notificationSettings)
      .values({ userId, guildId, channelId, ...values })
      .onDuplicateKeyUpdate({
        set: setClause,
      });
    const [result] = await db.select().from(schema.notificationSettings)
      .where(and(
        eq(schema.notificationSettings.userId, userId),
        eq(schema.notificationSettings.guildId, guildId),
        eq(schema.notificationSettings.channelId, channelId),
      ));
    return result!;
  },
};
