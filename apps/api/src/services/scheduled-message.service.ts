import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { scheduledMessageRepository } from "../repositories/scheduled-message.repository.js";

export async function createScheduledMessage(
  channelId: string,
  authorId: string,
  content: string,
  scheduledFor: Date
) {
  if (scheduledFor <= new Date()) {
    throw new ApiError(400, "Scheduled time must be in the future");
  }

  const id = generateSnowflake();
  const msg = await scheduledMessageRepository.create({
    id,
    channelId,
    authorId,
    content,
    scheduledFor,
  });

  return {
    ...msg,
    scheduledFor: msg.scheduledFor.toISOString(),
    createdAt: msg.createdAt.toISOString(),
  };
}

export async function getScheduledMessages(channelId: string, authorId: string) {
  const messages = await scheduledMessageRepository.findByChannelAndAuthor(channelId, authorId);

  return messages.map((m) => ({
    ...m,
    scheduledFor: m.scheduledFor.toISOString(),
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function deleteScheduledMessage(id: string, authorId: string) {
  const msg = await scheduledMessageRepository.findById(id);

  if (!msg) throw new ApiError(404, "Scheduled message not found");
  if (msg.authorId !== authorId) throw new ApiError(403, "Not your scheduled message");
  if (msg.sent) throw new ApiError(400, "Message already sent");

  await scheduledMessageRepository.delete(id);
}

export async function getDueScheduledMessages() {
  return scheduledMessageRepository.findDue();
}

export async function markAsSent(id: string) {
  await scheduledMessageRepository.markSent(id);
}
