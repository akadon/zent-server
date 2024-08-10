import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export interface UserNote {
  userId: string;
  targetUserId: string;
  note: string;
  updatedAt: Date;
}

// Get a note about a specific user
export async function getNote(userId: string, targetUserId: string): Promise<UserNote | null> {
  const [note] = await db
    .select()
    .from(schema.userNotes)
    .where(
      and(
        eq(schema.userNotes.userId, userId),
        eq(schema.userNotes.targetUserId, targetUserId)
      )
    )
    .limit(1);

  return note ?? null;
}

// Set or update a note about a user
export async function setNote(
  userId: string,
  targetUserId: string,
  note: string
): Promise<UserNote> {
  // Upsert the note
  const existing = await getNote(userId, targetUserId);

  if (existing) {
    await db
      .update(schema.userNotes)
      .set({ note, updatedAt: new Date() })
      .where(
        and(
          eq(schema.userNotes.userId, userId),
          eq(schema.userNotes.targetUserId, targetUserId)
        )
      );
  } else {
    await db.insert(schema.userNotes).values({
      userId,
      targetUserId,
      note,
    });
  }

  const updated = await getNote(userId, targetUserId);
  return updated!;
}

// Delete a note about a user
export async function deleteNote(userId: string, targetUserId: string): Promise<void> {
  await db
    .delete(schema.userNotes)
    .where(
      and(
        eq(schema.userNotes.userId, userId),
        eq(schema.userNotes.targetUserId, targetUserId)
      )
    );
}

// Get all notes for a user
export async function getAllNotes(userId: string): Promise<UserNote[]> {
  return await db
    .select()
    .from(schema.userNotes)
    .where(eq(schema.userNotes.userId, userId));
}
