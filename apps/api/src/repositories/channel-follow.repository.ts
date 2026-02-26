import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const channelFollowRepository = {
  async findById(id: string) {
    const [row] = await db.select().from(schema.channelFollowers).where(eq(schema.channelFollowers.id, id)).limit(1);
    return row ?? null;
  },
  async findByChannelId(channelId: string) {
    return db.select().from(schema.channelFollowers).where(eq(schema.channelFollowers.channelId, channelId));
  },
  async findByChannelAndWebhook(channelId: string, webhookId: string) {
    const [row] = await db
      .select()
      .from(schema.channelFollowers)
      .where(and(eq(schema.channelFollowers.channelId, channelId), eq(schema.channelFollowers.webhookId, webhookId)))
      .limit(1);
    return row ?? null;
  },
  async findByWebhookId(webhookId: string) {
    const [row] = await db.select().from(schema.channelFollowers).where(eq(schema.channelFollowers.webhookId, webhookId)).limit(1);
    return row ?? null;
  },
  async create(data: { id: string; channelId: string; webhookId: string; guildId: string }) {
    await db.insert(schema.channelFollowers).values(data);
    const [created] = await db.select().from(schema.channelFollowers).where(eq(schema.channelFollowers.id, data.id)).limit(1);
    return created!;
  },
  async delete(id: string) {
    await db.delete(schema.channelFollowers).where(eq(schema.channelFollowers.id, id));
  },
};
