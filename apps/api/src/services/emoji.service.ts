import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

export async function createEmoji(
  guildId: string,
  name: string,
  creatorId: string,
  animated: boolean = false
) {
  const id = generateSnowflake();

  const [emoji] = await db
    .insert(schema.emojis)
    .values({
      id,
      guildId,
      name,
      creatorId,
      animated,
    })
    .returning();

  return emoji!;
}

export async function getGuildEmojis(guildId: string) {
  return db
    .select()
    .from(schema.emojis)
    .where(eq(schema.emojis.guildId, guildId));
}

export async function getEmoji(emojiId: string) {
  const [emoji] = await db
    .select()
    .from(schema.emojis)
    .where(eq(schema.emojis.id, emojiId))
    .limit(1);

  if (!emoji) throw new ApiError(404, "Emoji not found");
  return emoji;
}

export async function updateEmoji(emojiId: string, name: string) {
  const [updated] = await db
    .update(schema.emojis)
    .set({ name })
    .where(eq(schema.emojis.id, emojiId))
    .returning();

  if (!updated) throw new ApiError(404, "Emoji not found");
  return updated;
}

export async function deleteEmoji(emojiId: string) {
  const [deleted] = await db
    .delete(schema.emojis)
    .where(eq(schema.emojis.id, emojiId))
    .returning();

  if (!deleted) throw new ApiError(404, "Emoji not found");
}
