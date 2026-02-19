import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

export interface Sticker {
  id: string;
  guildId: string | null;
  packId: string | null;
  name: string;
  description: string | null;
  tags: string;
  type: number; // 1=standard, 2=guild
  formatType: number; // 1=png, 2=apng, 3=lottie, 4=gif
  available: boolean;
  userId: string | null;
  sortValue: number | null;
}

export const StickerType = {
  STANDARD: 1,
  GUILD: 2,
} as const;

export const StickerFormatType = {
  PNG: 1,
  APNG: 2,
  LOTTIE: 3,
  GIF: 4,
} as const;

// ── Guild Stickers ──

export async function getGuildStickers(guildId: string): Promise<Sticker[]> {
  return db
    .select()
    .from(schema.stickers)
    .where(eq(schema.stickers.guildId, guildId));
}

export async function getSticker(stickerId: string): Promise<Sticker | null> {
  const [sticker] = await db
    .select()
    .from(schema.stickers)
    .where(eq(schema.stickers.id, stickerId))
    .limit(1);

  return sticker ?? null;
}

export async function createGuildSticker(
  guildId: string,
  userId: string,
  data: {
    name: string;
    description?: string;
    tags: string;
    formatType: number;
  }
): Promise<Sticker> {
  // Check sticker limits (50 for base, more with boosts)
  const existingStickers = await db
    .select()
    .from(schema.stickers)
    .where(eq(schema.stickers.guildId, guildId));

  // Get guild's premium tier for sticker limit
  const [guild] = await db
    .select({ premiumTier: schema.guilds.premiumTier })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  const stickerLimit = getStickerLimit(guild?.premiumTier ?? 0);

  if (existingStickers.length >= stickerLimit) {
    throw new ApiError(400, `This server has reached the maximum of ${stickerLimit} stickers`);
  }

  const id = generateSnowflake();

  await db
    .insert(schema.stickers)
    .values({
      id,
      guildId,
      name: data.name,
      description: data.description ?? null,
      tags: data.tags,
      type: StickerType.GUILD,
      formatType: data.formatType,
      available: true,
      userId,
    });

  const [sticker] = await db
    .select()
    .from(schema.stickers)
    .where(eq(schema.stickers.id, id))
    .limit(1);

  if (!sticker) {
    throw new ApiError(500, "Failed to create sticker");
  }

  return sticker;
}

export async function updateGuildSticker(
  guildId: string,
  stickerId: string,
  data: {
    name?: string;
    description?: string | null;
    tags?: string;
  }
): Promise<Sticker> {
  await db
    .update(schema.stickers)
    .set(data)
    .where(
      and(
        eq(schema.stickers.id, stickerId),
        eq(schema.stickers.guildId, guildId)
      )
    );

  const [sticker] = await db
    .select()
    .from(schema.stickers)
    .where(
      and(
        eq(schema.stickers.id, stickerId),
        eq(schema.stickers.guildId, guildId)
      )
    )
    .limit(1);

  if (!sticker) {
    throw new ApiError(404, "Sticker not found");
  }

  return sticker;
}

export async function deleteGuildSticker(guildId: string, stickerId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.stickers)
    .where(
      and(
        eq(schema.stickers.id, stickerId),
        eq(schema.stickers.guildId, guildId)
      )
    )
    .limit(1);

  if (!existing) {
    throw new ApiError(404, "Sticker not found");
  }

  await db
    .delete(schema.stickers)
    .where(
      and(
        eq(schema.stickers.id, stickerId),
        eq(schema.stickers.guildId, guildId)
      )
    );
}

// ── Message Stickers ──

export async function addStickerToMessage(
  messageId: string,
  stickerId: string
): Promise<void> {
  await db.insert(schema.messageStickers).values({
    messageId,
    stickerId,
  });
}

export async function getMessageStickers(messageId: string): Promise<Sticker[]> {
  const result = await db
    .select({ sticker: schema.stickers })
    .from(schema.messageStickers)
    .innerJoin(schema.stickers, eq(schema.messageStickers.stickerId, schema.stickers.id))
    .where(eq(schema.messageStickers.messageId, messageId));

  return result.map((r) => r.sticker);
}

// ── Sticker Packs (Standard Stickers) ──

export async function getStandardStickers(): Promise<Sticker[]> {
  return db
    .select()
    .from(schema.stickers)
    .where(
      and(
        eq(schema.stickers.type, StickerType.STANDARD),
        isNull(schema.stickers.guildId)
      )
    );
}

// ── Helpers ──

function getStickerLimit(premiumTier: number): number {
  switch (premiumTier) {
    case 0:
      return 5; // No boost
    case 1:
      return 15; // Level 1
    case 2:
      return 30; // Level 2
    case 3:
      return 60; // Level 3
    default:
      return 5;
  }
}

export function validateStickerFormat(formatType: number): boolean {
  return (
    formatType === StickerFormatType.PNG ||
    formatType === StickerFormatType.APNG ||
    formatType === StickerFormatType.LOTTIE ||
    formatType === StickerFormatType.GIF
  );
}
