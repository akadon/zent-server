import { eq, and, ne } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const sessionRepository = {
  async findByUserId(userId: string) {
    return db
      .select({
        id: schema.userSessions.id,
        deviceInfo: schema.userSessions.deviceInfo,
        ipAddress: schema.userSessions.ipAddress,
        lastActiveAt: schema.userSessions.lastActiveAt,
        createdAt: schema.userSessions.createdAt,
        expiresAt: schema.userSessions.expiresAt,
      })
      .from(schema.userSessions)
      .where(eq(schema.userSessions.userId, userId))
      .orderBy(schema.userSessions.lastActiveAt);
  },
  async findByIdAndUserId(sessionId: string, userId: string) {
    const [session] = await db
      .select()
      .from(schema.userSessions)
      .where(
        and(
          eq(schema.userSessions.id, sessionId),
          eq(schema.userSessions.userId, userId),
        ),
      )
      .limit(1);
    return session ?? null;
  },
  async deleteByIdAndUserId(sessionId: string, userId: string) {
    await db
      .delete(schema.userSessions)
      .where(
        and(
          eq(schema.userSessions.id, sessionId),
          eq(schema.userSessions.userId, userId),
        ),
      );
  },
  async deleteByUserIdExcept(userId: string, exceptSessionId: string) {
    await db
      .delete(schema.userSessions)
      .where(
        and(
          eq(schema.userSessions.userId, userId),
          ne(schema.userSessions.id, exceptSessionId),
        ),
      );
  },
  async deleteAllByUserId(userId: string) {
    await db
      .delete(schema.userSessions)
      .where(eq(schema.userSessions.userId, userId));
  },
};
