import { ApiError } from "./auth.service.js";
import { reactionRepository } from "../repositories/reaction.repository.js";
import { messageRepository } from "../repositories/message.repository.js";

export async function addReaction(
  messageId: string,
  userId: string,
  emojiName: string,
  emojiId?: string
) {
  // Verify message exists
  const message = await messageRepository.findById(messageId);

  if (!message) throw new ApiError(404, "Message not found");

  // Use "" for unicode emoji (no custom ID) — keeps composite PK valid in PostgreSQL
  await reactionRepository.createIgnoreConflict({
    messageId,
    userId,
    emojiName,
    emojiId: emojiId ?? "",
  });

  return { messageId, channelId: message.channelId, emojiName, emojiId: emojiId ?? null };
}

export async function removeReaction(
  messageId: string,
  userId: string,
  emojiName: string,
  emojiId?: string
) {
  await reactionRepository.delete(messageId, userId, emojiName, emojiId);
}

export async function getReactions(
  messageId: string,
  emojiName: string,
  emojiId?: string
) {
  return reactionRepository.findUsersWithDetails(messageId, emojiName, emojiId);
}

export async function removeAllReactions(messageId: string) {
  await reactionRepository.deleteAllForMessage(messageId);
}
