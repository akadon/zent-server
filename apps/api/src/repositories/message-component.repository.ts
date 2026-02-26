import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const messageComponentRepository = {
  async findByMessageId(messageId: string) {
    return db
      .select()
      .from(schema.messageComponents)
      .where(eq(schema.messageComponents.messageId, messageId))
      .orderBy(schema.messageComponents.position);
  },
  async create(data: {
    id: string;
    messageId: string;
    type: number;
    customId?: string;
    label?: string;
    style?: number;
    url?: string;
    disabled?: boolean;
    emoji?: any;
    options?: any;
    placeholder?: string;
    minValues?: number;
    maxValues?: number;
    minLength?: number;
    maxLength?: number;
    required?: boolean;
    parentId?: string;
    position: number;
  }) {
    await db.insert(schema.messageComponents).values(data);
  },
  async deleteByMessageId(messageId: string) {
    await db.delete(schema.messageComponents).where(eq(schema.messageComponents.messageId, messageId));
  },
};
