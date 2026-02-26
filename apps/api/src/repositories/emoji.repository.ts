import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const emojiRepository = {
  async findById(id: string) {
    const [emoji] = await db.select().from(schema.emojis).where(eq(schema.emojis.id, id)).limit(1);
    return emoji ?? null;
  },
  async findByGuildId(guildId: string) {
    return db.select().from(schema.emojis).where(eq(schema.emojis.guildId, guildId));
  },
  async create(data: {
    id: string;
    guildId: string;
    name: string;
    creatorId?: string | null;
    animated?: boolean;
  }) {
    await db.insert(schema.emojis).values(data);
    return (await db.select().from(schema.emojis).where(eq(schema.emojis.id, data.id)).limit(1))[0]!;
  },
  async update(id: string, data: Partial<{ name: string; available: boolean }>) {
    await db.update(schema.emojis).set(data).where(eq(schema.emojis.id, id));
    return (await db.select().from(schema.emojis).where(eq(schema.emojis.id, id)).limit(1))[0]!;
  },
  async delete(id: string) {
    await db.delete(schema.emojis).where(eq(schema.emojis.id, id));
  },
};
