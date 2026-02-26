import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const userNotesRepository = {
  async findByUserAndTarget(userId: string, targetUserId: string) {
    const [note] = await db
      .select()
      .from(schema.userNotes)
      .where(
        and(
          eq(schema.userNotes.userId, userId),
          eq(schema.userNotes.targetUserId, targetUserId),
        ),
      )
      .limit(1);
    return note ?? null;
  },
  async upsert(userId: string, targetUserId: string, note: string) {
    await db
      .insert(schema.userNotes)
      .values({ userId, targetUserId, note, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.userNotes.userId, schema.userNotes.targetUserId],
        set: { note, updatedAt: new Date() },
      });
  },
  async delete(userId: string, targetUserId: string) {
    await db
      .delete(schema.userNotes)
      .where(
        and(
          eq(schema.userNotes.userId, userId),
          eq(schema.userNotes.targetUserId, targetUserId),
        ),
      );
  },
  async findAllByUserId(userId: string) {
    return db
      .select()
      .from(schema.userNotes)
      .where(eq(schema.userNotes.userId, userId));
  },
};
