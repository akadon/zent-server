import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const channelRepository = {
  async findById(id: string) {
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, id)).limit(1);
    return channel ?? null;
  },
  async findByGuildId(guildId: string) {
    return db.select().from(schema.channels).where(eq(schema.channels.guildId, guildId));
  },
  async findByGuildIds(guildIds: string[]) {
    if (guildIds.length === 0) return [];
    return db.select().from(schema.channels).where(inArray(schema.channels.guildId, guildIds));
  },
  async create(data: any) {
    await db.insert(schema.channels).values(data);
    const [created] = await db.select().from(schema.channels).where(eq(schema.channels.id, typeof data === 'object' && !Array.isArray(data) ? data.id : data[0].id)).limit(1);
    return created!;
  },
  async createMany(tx: any, data: any[]) {
    await tx.insert(schema.channels).values(data);
  },
  async update(id: string, data: Record<string, any>) {
    await db.update(schema.channels).set(data).where(eq(schema.channels.id, id));
    const [updated] = await db.select().from(schema.channels).where(eq(schema.channels.id, id)).limit(1);
    return updated!;
  },
  async delete(id: string) {
    await db.delete(schema.channels).where(eq(schema.channels.id, id));
  },
  // DM channels
  async findDMChannelIdsByUserId(userId: string) {
    const rows = await db
      .select({ channelId: schema.dmChannels.channelId })
      .from(schema.dmChannels)
      .where(eq(schema.dmChannels.userId, userId));
    return rows.map((r) => r.channelId);
  },
  async findDMRecipient(channelId: string, recipientId: string) {
    const [row] = await db
      .select()
      .from(schema.dmChannels)
      .where(and(eq(schema.dmChannels.channelId, channelId), eq(schema.dmChannels.userId, recipientId)))
      .limit(1);
    return row ?? null;
  },
  async findDMParticipantsByChannelIds(channelIds: string[]) {
    if (channelIds.length === 0) return [];
    return db
      .select({ channelId: schema.dmChannels.channelId, userId: schema.dmChannels.userId })
      .from(schema.dmChannels)
      .where(inArray(schema.dmChannels.channelId, channelIds));
  },
  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return db.select().from(schema.channels).where(inArray(schema.channels.id, ids));
  },
  async createDMChannel(channelId: string, type: number, userIds: string[]) {
    await db.transaction(async (tx) => {
      await tx.insert(schema.channels).values({
        id: channelId,
        type,
        name: null,
        position: 0,
      });
      await tx.insert(schema.dmChannels).values(
        userIds.map((uid) => ({ channelId, userId: uid })),
      );
    });
  },
};
