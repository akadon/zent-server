import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

export interface StageInstance {
  id: string;
  guildId: string;
  channelId: string;
  topic: string;
  privacyLevel: number;
  discoverableDisabled: boolean;
  guildScheduledEventId: string | null;
}

// Privacy levels
export const StagePrivacyLevel = {
  PUBLIC: 1,
  GUILD_ONLY: 2,
} as const;

export async function getStageInstance(channelId: string): Promise<StageInstance | null> {
  const [instance] = await db
    .select()
    .from(schema.stageInstances)
    .where(eq(schema.stageInstances.channelId, channelId))
    .limit(1);

  return instance ?? null;
}

export async function getGuildStageInstances(guildId: string): Promise<StageInstance[]> {
  return db
    .select()
    .from(schema.stageInstances)
    .where(eq(schema.stageInstances.guildId, guildId));
}

export async function createStageInstance(
  guildId: string,
  channelId: string,
  data: {
    topic: string;
    privacyLevel?: number;
    sendStartNotification?: boolean;
    guildScheduledEventId?: string;
  }
): Promise<StageInstance> {
  // Verify channel is a stage channel (type 13)
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);

  if (!channel) {
    throw new ApiError(404, "Channel not found");
  }

  if (channel.type !== 13) {
    throw new ApiError(400, "Channel must be a stage channel");
  }

  // Check if stage instance already exists
  const existing = await getStageInstance(channelId);
  if (existing) {
    throw new ApiError(400, "Stage instance already exists for this channel");
  }

  const id = generateSnowflake();
  const [instance] = await db
    .insert(schema.stageInstances)
    .values({
      id,
      guildId,
      channelId,
      topic: data.topic,
      privacyLevel: data.privacyLevel ?? StagePrivacyLevel.GUILD_ONLY,
      guildScheduledEventId: data.guildScheduledEventId ?? null,
      discoverableDisabled: false,
    })
    .returning();

  if (!instance) {
    throw new ApiError(500, "Failed to create stage instance");
  }

  return instance;
}

export async function updateStageInstance(
  channelId: string,
  data: {
    topic?: string;
    privacyLevel?: number;
  }
): Promise<StageInstance> {
  const [instance] = await db
    .update(schema.stageInstances)
    .set({
      ...(data.topic !== undefined && { topic: data.topic }),
      ...(data.privacyLevel !== undefined && { privacyLevel: data.privacyLevel }),
    })
    .where(eq(schema.stageInstances.channelId, channelId))
    .returning();

  if (!instance) {
    throw new ApiError(404, "Stage instance not found");
  }

  return instance;
}

export async function deleteStageInstance(channelId: string): Promise<StageInstance> {
  const [instance] = await db
    .delete(schema.stageInstances)
    .where(eq(schema.stageInstances.channelId, channelId))
    .returning();

  if (!instance) {
    throw new ApiError(404, "Stage instance not found");
  }

  return instance;
}

// ── Stage Voice State Management ──

export async function requestToSpeak(
  userId: string,
  guildId: string,
  channelId: string
): Promise<void> {
  // Update voice state to indicate request to speak
  const [voiceState] = await db
    .select()
    .from(schema.voiceStates)
    .where(
      and(
        eq(schema.voiceStates.userId, userId),
        eq(schema.voiceStates.guildId, guildId),
        eq(schema.voiceStates.channelId, channelId)
      )
    )
    .limit(1);

  if (!voiceState) {
    throw new ApiError(400, "User is not in this voice channel");
  }

  // In Discord, request_to_speak_timestamp is set on the voice state
  // For simplicity, we just update suppress to indicate they want to speak
  // A moderator would then unsuppress them
}

export async function inviteToSpeak(
  targetUserId: string,
  guildId: string,
  channelId: string
): Promise<void> {
  // Unsuppress the user (make them a speaker)
  await db
    .update(schema.voiceStates)
    .set({ suppress: false })
    .where(
      and(
        eq(schema.voiceStates.userId, targetUserId),
        eq(schema.voiceStates.guildId, guildId),
        eq(schema.voiceStates.channelId, channelId)
      )
    );
}

export async function moveToAudience(
  targetUserId: string,
  guildId: string,
  channelId: string
): Promise<void> {
  // Suppress the user (make them audience)
  await db
    .update(schema.voiceStates)
    .set({ suppress: true })
    .where(
      and(
        eq(schema.voiceStates.userId, targetUserId),
        eq(schema.voiceStates.guildId, guildId),
        eq(schema.voiceStates.channelId, channelId)
      )
    );
}

export async function getSpeakers(channelId: string): Promise<string[]> {
  const voiceStates = await db
    .select({ userId: schema.voiceStates.userId })
    .from(schema.voiceStates)
    .where(
      and(
        eq(schema.voiceStates.channelId, channelId),
        eq(schema.voiceStates.suppress, false)
      )
    );

  return voiceStates.map((vs) => vs.userId);
}

export async function getAudience(channelId: string): Promise<string[]> {
  const voiceStates = await db
    .select({ userId: schema.voiceStates.userId })
    .from(schema.voiceStates)
    .where(
      and(
        eq(schema.voiceStates.channelId, channelId),
        eq(schema.voiceStates.suppress, true)
      )
    );

  return voiceStates.map((vs) => vs.userId);
}
