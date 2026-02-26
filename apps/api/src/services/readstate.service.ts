import { readstateRepository } from "../repositories/readstate.repository.js";

export async function ackMessage(userId: string, channelId: string, messageId: string) {
  await readstateRepository.upsert(userId, channelId, messageId);
}

export async function getReadStates(userId: string) {
  return readstateRepository.findByUserId(userId);
}

export async function incrementMentionCount(userId: string, channelId: string) {
  await readstateRepository.incrementMentionCount(userId, channelId);
}
