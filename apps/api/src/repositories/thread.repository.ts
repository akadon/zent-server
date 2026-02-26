import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const threadRepository = {
  async findById(channelId: string) {
    const [thread] = await db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .limit(1);
    return thread ?? null;
  },
  async findByParentId(parentId: string) {
    return db.select().from(schema.channels).where(eq(schema.channels.parentId, parentId));
  },
  async create(data: {
    id: string;
    guildId?: string | null;
    type: number;
    name?: string | null;
    parentId?: string | null;
    ownerId?: string | null;
  }) {
    await db.insert(schema.channels).values(data);
    return (await db.select().from(schema.channels).where(eq(schema.channels.id, data.id)).limit(1))[0]!;
  },
  async update(channelId: string, data: Partial<{ name: string | null; flags: number }>) {
    await db.update(schema.channels).set(data).where(eq(schema.channels.id, channelId));
    return (await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1))[0]!;
  },
  async addMember(channelId: string, userId: string) {
    await db
      .insert(schema.threadMembers)
      .values({ channelId, userId })
      .onDuplicateKeyUpdate({ set: { channelId: sql`channel_id` } });
  },
  async removeMember(channelId: string, userId: string) {
    await db
      .delete(schema.threadMembers)
      .where(
        and(
          eq(schema.threadMembers.channelId, channelId),
          eq(schema.threadMembers.userId, userId),
        ),
      );
  },
  async findMembers(channelId: string) {
    return db
      .select()
      .from(schema.threadMembers)
      .where(eq(schema.threadMembers.channelId, channelId));
  },
  async findMetadata(channelId: string) {
    const [metadata] = await db
      .select()
      .from(schema.threadMetadata)
      .where(eq(schema.threadMetadata.channelId, channelId))
      .limit(1);
    return metadata ?? null;
  },
  async createMetadata(data: {
    channelId: string;
    autoArchiveDuration?: number;
  }) {
    await db.insert(schema.threadMetadata).values(data);
  },
  async updateMetadata(channelId: string, data: Record<string, unknown>) {
    await db
      .update(schema.threadMetadata)
      .set(data)
      .where(eq(schema.threadMetadata.channelId, channelId));
  },
  async deleteThread(channelId: string) {
    await db.delete(schema.threadMembers).where(eq(schema.threadMembers.channelId, channelId));
    await db.delete(schema.threadMetadata).where(eq(schema.threadMetadata.channelId, channelId));
    await db.delete(schema.channels).where(eq(schema.channels.id, channelId));
  },
  async createThreadTransaction(
    channelData: {
      id: string;
      guildId: string | null;
      type: number;
      name: string;
      parentId: string;
      ownerId: string;
      position: number;
    },
    metadataData: { channelId: string; autoArchiveDuration: number },
    creatorId: string,
  ) {
    await db.transaction(async (tx) => {
      await tx.insert(schema.channels).values(channelData);
      await tx.insert(schema.threadMetadata).values(metadataData);
      await tx.insert(schema.threadMembers).values({
        channelId: channelData.id,
        userId: creatorId,
      });
    });
  },
};
