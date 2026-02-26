import { eq, and, lte } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const scheduledMessageRepository = {
  async findById(id: string) {
    const [msg] = await db
      .select()
      .from(schema.scheduledMessages)
      .where(eq(schema.scheduledMessages.id, id))
      .limit(1);
    return msg ?? null;
  },
  async findByChannelId(channelId: string) {
    return db
      .select()
      .from(schema.scheduledMessages)
      .where(eq(schema.scheduledMessages.channelId, channelId));
  },
  async findByChannelAndAuthor(channelId: string, authorId: string) {
    return db
      .select()
      .from(schema.scheduledMessages)
      .where(
        and(
          eq(schema.scheduledMessages.channelId, channelId),
          eq(schema.scheduledMessages.authorId, authorId),
          eq(schema.scheduledMessages.sent, false),
        ),
      );
  },
  async findDue() {
    return db
      .select()
      .from(schema.scheduledMessages)
      .where(
        and(
          eq(schema.scheduledMessages.sent, false),
          lte(schema.scheduledMessages.scheduledFor, new Date()),
        ),
      );
  },
  async create(data: {
    id: string;
    channelId: string;
    authorId: string;
    content: string;
    scheduledFor: Date;
  }) {
    await db.insert(schema.scheduledMessages).values(data);
    return (await db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.id, data.id)).limit(1))[0]!;
  },
  async markSent(id: string) {
    await db
      .update(schema.scheduledMessages)
      .set({ sent: true })
      .where(eq(schema.scheduledMessages.id, id));
  },
  async delete(id: string) {
    await db.delete(schema.scheduledMessages).where(eq(schema.scheduledMessages.id, id));
  },
};
