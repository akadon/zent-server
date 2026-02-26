import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const threadTemplateRepository = {
  async findById(id: string) {
    const [row] = await db.select().from(schema.threadTemplates).where(eq(schema.threadTemplates.id, id)).limit(1);
    return row ?? null;
  },
  async findByChannelId(channelId: string) {
    return db.select().from(schema.threadTemplates).where(eq(schema.threadTemplates.channelId, channelId));
  },
  async create(data: { id: string; channelId: string; guildId: string; name: string; content: string; createdBy: string }) {
    await db.insert(schema.threadTemplates).values(data);
    const [created] = await db.select().from(schema.threadTemplates).where(eq(schema.threadTemplates.id, data.id)).limit(1);
    return created!;
  },
  async delete(id: string) {
    await db.delete(schema.threadTemplates).where(eq(schema.threadTemplates.id, id));
  },
};
