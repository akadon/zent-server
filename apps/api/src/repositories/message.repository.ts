import { eq, and, lt, lte, desc, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { redis } from "../config/redis.js";

// Redis cache for recent messages per channel (NoSQL-like document access)
const MSG_CACHE_PREFIX = "msgcache:";
const MSG_CACHE_TTL = 300; // 5 minutes
const MSG_CACHE_MAX = 50; // cache last 50 messages per channel

type AuthorSnapshot = { id: string; username: string; displayName: string | null; avatar: string | null };

const authorColumns = {
  id: schema.users.id,
  username: schema.users.username,
  displayName: schema.users.displayName,
  avatar: schema.users.avatar,
  status: schema.users.status,
} as const;

export const messageRepository = {
  async findById(id: string) {
    const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, id)).limit(1);
    return msg ?? null;
  },

  /**
   * Primary read path — uses embedded authorSnapshot, no JOIN.
   * NoSQL-ready: partition by channelId, sort by id desc.
   */
  async findByChannelId(channelId: string, options?: { before?: string; limit?: number }) {
    const limit = options?.limit ?? 50;

    // Try Redis cache first (only for first page with no cursor)
    if (!options?.before && limit <= MSG_CACHE_MAX) {
      const cached = await redis.get(`${MSG_CACHE_PREFIX}${channelId}`);
      if (cached) {
        try {
          const messages = JSON.parse(cached);
          return messages.slice(0, limit);
        } catch { /* cache corrupt, fall through */ }
      }
    }

    const rows = await db.select().from(schema.messages).where(
      options?.before
        ? and(eq(schema.messages.channelId, channelId), lt(schema.messages.id, options.before))
        : eq(schema.messages.channelId, channelId)
    ).orderBy(desc(schema.messages.id)).limit(limit);

    // Warm cache for first page
    if (!options?.before && rows.length > 0) {
      redis.setex(`${MSG_CACHE_PREFIX}${channelId}`, MSG_CACHE_TTL, JSON.stringify(rows)).catch(() => {});
    }

    return rows;
  },

  /**
   * Legacy read path with JOIN — used only for referenced messages and migration.
   * Will be removed once all messages have authorSnapshot populated.
   */
  async findByChannelIdWithAuthor(channelId: string, options?: { before?: string; limit?: number }) {
    const limit = options?.limit ?? 50;
    return db.select({ message: schema.messages, author: authorColumns })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.authorId, schema.users.id))
      .where(
        options?.before
          ? and(eq(schema.messages.channelId, channelId), lt(schema.messages.id, options.before))
          : eq(schema.messages.channelId, channelId)
      )
      .orderBy(desc(schema.messages.id))
      .limit(limit);
  },

  async findPinned(channelId: string) {
    return db.select().from(schema.messages)
      .where(and(eq(schema.messages.channelId, channelId), eq(schema.messages.pinned, true)))
      .orderBy(desc(schema.messages.id));
  },

  async findPinnedWithAuthor(channelId: string) {
    return db.select({ message: schema.messages, author: authorColumns })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.authorId, schema.users.id))
      .where(and(eq(schema.messages.channelId, channelId), eq(schema.messages.pinned, true)))
      .orderBy(desc(schema.messages.id))
      .limit(50);
  },

  async findByIdsWithAuthor(ids: string[]) {
    if (ids.length === 0) return [];
    return db.select({ message: schema.messages, author: authorColumns })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.authorId, schema.users.id))
      .where(inArray(schema.messages.id, ids));
  },

  async create(data: {
    id: string; channelId: string; authorId: string; content: string;
    type?: number; tts?: boolean; mentionEveryone?: boolean;
    referencedMessageId?: string | null; webhookId?: string | null;
    nonce?: string | null; expiresAt?: Date | null; createdAt?: Date;
    authorSnapshot?: AuthorSnapshot | null;
  }) {
    await db.insert(schema.messages).values(data);
    const [created] = await db.select().from(schema.messages).where(eq(schema.messages.id, data.id)).limit(1);

    // Invalidate channel message cache
    redis.del(`${MSG_CACHE_PREFIX}${data.channelId}`).catch(() => {});

    return created!;
  },

  async update(id: string, data: Record<string, any>) {
    await db.update(schema.messages).set(data).where(eq(schema.messages.id, id));
    // Invalidate cache — find channelId first
    const [msg] = await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, id)).limit(1);
    if (msg) redis.del(`${MSG_CACHE_PREFIX}${msg.channelId}`).catch(() => {});
  },

  async delete(id: string) {
    const [msg] = await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, id)).limit(1);
    await db.delete(schema.messages).where(eq(schema.messages.id, id));
    if (msg) redis.del(`${MSG_CACHE_PREFIX}${msg.channelId}`).catch(() => {});
  },

  async deleteByIds(ids: string[]) {
    if (ids.length === 0) return;
    // Get channelIds for cache invalidation
    const msgs = await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(inArray(schema.messages.id, ids));
    await db.delete(schema.messages).where(inArray(schema.messages.id, ids));
    const channelIds = [...new Set(msgs.map(m => m.channelId))];
    if (channelIds.length > 0) {
      redis.del(...channelIds.map(c => `${MSG_CACHE_PREFIX}${c}`)).catch(() => {});
    }
  },

  async setPin(id: string, pinned: boolean) {
    await db.update(schema.messages).set({ pinned }).where(eq(schema.messages.id, id));
    const [msg] = await db.select({ channelId: schema.messages.channelId }).from(schema.messages).where(eq(schema.messages.id, id)).limit(1);
    if (msg) redis.del(`${MSG_CACHE_PREFIX}${msg.channelId}`).catch(() => {});
  },

  async updateLastMessageId(channelId: string, messageId: string) {
    await db.update(schema.channels).set({ lastMessageId: messageId }).where(eq(schema.channels.id, channelId));
  },

  // Attachments
  async createAttachments(attachments: any[]) {
    if (attachments.length === 0) return;
    await db.insert(schema.messageAttachments).values(attachments);
  },

  async findAttachmentsByMessageIds(messageIds: string[]) {
    if (messageIds.length === 0) return [];
    return db.select().from(schema.messageAttachments).where(inArray(schema.messageAttachments.messageId, messageIds));
  },

  async findByAuthorId(authorId: string, limit = 10000) {
    return db.select({
      id: schema.messages.id,
      channelId: schema.messages.channelId,
      content: schema.messages.content,
      createdAt: schema.messages.createdAt,
    }).from(schema.messages).where(eq(schema.messages.authorId, authorId)).limit(limit);
  },

  /** Invalidate message cache for a channel */
  async invalidateCache(channelId: string) {
    await redis.del(`${MSG_CACHE_PREFIX}${channelId}`);
  },

  /** Find expired messages (for background cleanup job) */
  async findExpired(limit = 100) {
    return db.select({ id: schema.messages.id, channelId: schema.messages.channelId })
      .from(schema.messages)
      .where(and(isNotNull(schema.messages.expiresAt), lte(schema.messages.expiresAt, new Date())))
      .limit(limit);
  },
};
