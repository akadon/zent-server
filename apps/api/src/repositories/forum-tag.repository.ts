import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const forumTagRepository = {
  async findById(id: string) {
    const [tag] = await db.select().from(schema.forumTags).where(eq(schema.forumTags.id, id)).limit(1);
    return tag ?? null;
  },
  async findByChannelId(channelId: string) {
    return db.select().from(schema.forumTags).where(eq(schema.forumTags.channelId, channelId)).orderBy(schema.forumTags.position);
  },
  async findAllByChannelId(channelId: string) {
    return db.select().from(schema.forumTags).where(eq(schema.forumTags.channelId, channelId));
  },
  async create(data: {
    id: string;
    channelId: string;
    name: string;
    emojiId: string | null;
    emojiName: string | null;
    moderated: boolean;
    position: number;
  }) {
    await db.insert(schema.forumTags).values(data);
    const [created] = await db.select().from(schema.forumTags).where(eq(schema.forumTags.id, data.id)).limit(1);
    return created!;
  },
  async update(id: string, data: Partial<{
    name: string;
    emojiId: string | null;
    emojiName: string | null;
    moderated: boolean;
    position: number;
  }>) {
    await db.update(schema.forumTags).set(data).where(eq(schema.forumTags.id, id));
    const [updated] = await db.select().from(schema.forumTags).where(eq(schema.forumTags.id, id)).limit(1);
    return updated ?? null;
  },
  async updatePosition(id: string, channelId: string, position: number) {
    await db.update(schema.forumTags).set({ position }).where(and(eq(schema.forumTags.id, id), eq(schema.forumTags.channelId, channelId)));
  },
  async delete(id: string) {
    await db.delete(schema.forumTags).where(eq(schema.forumTags.id, id));
  },
  // Post tags
  async findPostTags(threadId: string) {
    return db
      .select({ tag: schema.forumTags })
      .from(schema.forumPostTags)
      .innerJoin(schema.forumTags, eq(schema.forumPostTags.tagId, schema.forumTags.id))
      .where(eq(schema.forumPostTags.threadId, threadId));
  },
  async deletePostTags(threadId: string) {
    await db.delete(schema.forumPostTags).where(eq(schema.forumPostTags.threadId, threadId));
  },
  async insertPostTags(rows: Array<{ threadId: string; tagId: string }>) {
    if (rows.length === 0) return;
    await db.insert(schema.forumPostTags).values(rows);
  },
  async insertPostTag(threadId: string, tagId: string) {
    await db.insert(schema.forumPostTags).values({ threadId, tagId });
  },
  async deletePostTag(threadId: string, tagId: string) {
    await db.delete(schema.forumPostTags).where(and(eq(schema.forumPostTags.threadId, threadId), eq(schema.forumPostTags.tagId, tagId)));
  },
  // Thread parent lookup
  async findThreadParentId(threadId: string) {
    const [row] = await db.select({ parentId: schema.channels.parentId }).from(schema.channels).where(eq(schema.channels.id, threadId)).limit(1);
    return row?.parentId ?? null;
  },
};
