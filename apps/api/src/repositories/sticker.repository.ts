import { eq, isNull, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const stickerRepository = {
  async findById(id: string) {
    const [sticker] = await db.select().from(schema.stickers).where(eq(schema.stickers.id, id)).limit(1);
    return sticker ?? null;
  },
  async findByGuildId(guildId: string) {
    return db.select().from(schema.stickers).where(eq(schema.stickers.guildId, guildId));
  },
  async create(data: {
    id: string;
    guildId?: string | null;
    packId?: string | null;
    name: string;
    description?: string | null;
    tags: string;
    type: number;
    formatType: number;
    userId?: string | null;
    sortValue?: number | null;
  }) {
    await db.insert(schema.stickers).values(data);
    return (await db.select().from(schema.stickers).where(eq(schema.stickers.id, data.id)).limit(1))[0]!;
  },
  async update(id: string, data: Partial<{ name: string; description: string | null; tags: string; available: boolean; sortValue: number | null }>) {
    await db.update(schema.stickers).set(data).where(eq(schema.stickers.id, id));
    return (await db.select().from(schema.stickers).where(eq(schema.stickers.id, id)).limit(1))[0]!;
  },
  async delete(id: string) {
    await db.delete(schema.stickers).where(eq(schema.stickers.id, id));
  },
  async findStandard() {
    return db.select().from(schema.stickers).where(isNull(schema.stickers.guildId));
  },
  async addToMessage(messageId: string, stickerId: string) {
    await db.insert(schema.messageStickers).values({ messageId, stickerId });
  },
  async findByMessageIds(messageIds: string[]) {
    if (messageIds.length === 0) return [];
    return db.select().from(schema.messageStickers).where(inArray(schema.messageStickers.messageId, messageIds));
  },
  async findByMessageId(messageId: string) {
    const result = await db
      .select({ sticker: schema.stickers })
      .from(schema.messageStickers)
      .innerJoin(schema.stickers, eq(schema.messageStickers.stickerId, schema.stickers.id))
      .where(eq(schema.messageStickers.messageId, messageId));
    return result.map((r) => r.sticker);
  },
};
