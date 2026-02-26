import { userNotesRepository } from "../repositories/user-notes.repository.js";

export interface UserNote {
  userId: string;
  targetUserId: string;
  note: string;
  updatedAt: Date;
}

// Get a note about a specific user
export async function getNote(userId: string, targetUserId: string): Promise<UserNote | null> {
  return userNotesRepository.findByUserAndTarget(userId, targetUserId);
}

// Set or update a note about a user
export async function setNote(
  userId: string,
  targetUserId: string,
  note: string
): Promise<UserNote> {
  await userNotesRepository.upsert(userId, targetUserId, note);
  const updated = await userNotesRepository.findByUserAndTarget(userId, targetUserId);
  return updated!;
}

// Delete a note about a user
export async function deleteNote(userId: string, targetUserId: string): Promise<void> {
  await userNotesRepository.delete(userId, targetUserId);
}

// Get all notes for a user
export async function getAllNotes(userId: string): Promise<UserNote[]> {
  return userNotesRepository.findAllByUserId(userId);
}
