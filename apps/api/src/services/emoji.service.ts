import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { emojiRepository } from "../repositories/emoji.repository.js";

export async function createEmoji(
  guildId: string,
  name: string,
  creatorId: string,
  animated: boolean = false
) {
  const id = generateSnowflake();
  return emojiRepository.create({ id, guildId, name, creatorId, animated });
}

export async function getGuildEmojis(guildId: string) {
  return emojiRepository.findByGuildId(guildId);
}

export async function getEmoji(emojiId: string) {
  const emoji = await emojiRepository.findById(emojiId);
  if (!emoji) throw new ApiError(404, "Emoji not found");
  return emoji;
}

export async function updateEmoji(emojiId: string, name: string) {
  const updated = await emojiRepository.update(emojiId, { name });
  if (!updated) throw new ApiError(404, "Emoji not found");
  return updated;
}

export async function deleteEmoji(emojiId: string) {
  const existing = await emojiRepository.findById(emojiId);
  if (!existing) throw new ApiError(404, "Emoji not found");
  await emojiRepository.delete(emojiId);
}
