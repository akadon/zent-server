import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const webhookRepository = {
  async findById(id: string) {
    const [webhook] = await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).limit(1);
    return webhook ?? null;
  },
  async findByChannelId(channelId: string) {
    return db.select().from(schema.webhooks).where(eq(schema.webhooks.channelId, channelId));
  },
  async findByGuildId(guildId: string) {
    return db.select().from(schema.webhooks).where(eq(schema.webhooks.guildId, guildId));
  },
  async create(data: {
    id: string;
    guildId: string;
    channelId: string;
    type?: number;
    name?: string | null;
    avatar?: string | null;
    token?: string | null;
    creatorId?: string | null;
  }) {
    await db.insert(schema.webhooks).values(data);
    return (await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, data.id)).limit(1))[0]!;
  },
  async update(id: string, data: Partial<{ name: string | null; avatar: string | null; channelId: string }>) {
    await db.update(schema.webhooks).set(data).where(eq(schema.webhooks.id, id));
    return (await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).limit(1))[0]!;
  },
  async delete(id: string) {
    await db.delete(schema.webhooks).where(eq(schema.webhooks.id, id));
  },
};
