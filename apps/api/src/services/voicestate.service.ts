import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { ApiError } from "./auth.service.js";
import { env } from "../config/env.js";
import crypto from "crypto";

// LiveKit token generation (JWT-based, compatible with LiveKit server)
function createLiveKitToken(roomName: string, participantId: string, participantName: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: env.LIVEKIT_API_KEY,
      sub: participantId,
      nbf: now,
      exp: now + 86400, // 24h
      iat: now,
      jti: crypto.randomUUID(),
      video: {
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
      name: participantName,
      metadata: JSON.stringify({ participantId }),
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", env.LIVEKIT_API_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

export async function joinVoiceChannel(
  userId: string,
  guildId: string,
  channelId: string,
  sessionId: string,
  options?: { selfMute?: boolean; selfDeaf?: boolean }
) {
  // Verify the channel is a voice channel
  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);

  if (!channel) throw new ApiError(404, "Channel not found");
  // Types 2 (GUILD_VOICE), 13 (GUILD_STAGE_VOICE)
  if (channel.type !== 2 && channel.type !== 13) {
    throw new ApiError(400, "Not a voice channel");
  }

  // Check user limit
  if (channel.userLimit && channel.userLimit > 0) {
    const currentUsers = await db
      .select()
      .from(schema.voiceStates)
      .where(eq(schema.voiceStates.channelId, channelId));
    if (currentUsers.length >= channel.userLimit) {
      throw new ApiError(400, "Voice channel is full");
    }
  }

  // Leave any existing voice channel in this guild first
  await db
    .delete(schema.voiceStates)
    .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)));

  // Insert new voice state
  await db.insert(schema.voiceStates).values({
    userId,
    guildId,
    channelId,
    sessionId,
    selfMute: options?.selfMute ?? false,
    selfDeaf: options?.selfDeaf ?? false,
  });

  // Generate LiveKit token
  const roomName = `voice-${guildId}-${channelId}`;
  const [user] = await db
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const livekitToken = createLiveKitToken(roomName, userId, user?.username ?? "Unknown");

  return {
    userId,
    guildId,
    channelId,
    sessionId,
    selfMute: options?.selfMute ?? false,
    selfDeaf: options?.selfDeaf ?? false,
    deaf: false,
    mute: false,
    selfStream: false,
    selfVideo: false,
    suppress: channel.type === 13, // Suppress by default in stage channels
    livekitToken,
    livekitUrl: env.LIVEKIT_URL,
  };
}

export async function leaveVoiceChannel(userId: string, guildId: string) {
  const [existing] = await db
    .select()
    .from(schema.voiceStates)
    .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)))
    .limit(1);

  if (!existing) return null;

  await db
    .delete(schema.voiceStates)
    .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)));

  return existing;
}

export async function updateVoiceState(
  userId: string,
  guildId: string,
  data: {
    selfMute?: boolean;
    selfDeaf?: boolean;
    selfStream?: boolean;
    selfVideo?: boolean;
  }
) {
  const [updated] = await db
    .update(schema.voiceStates)
    .set(data)
    .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)))
    .returning();

  if (!updated) throw new ApiError(404, "Not in a voice channel");
  return updated;
}

export async function serverMuteDeafen(
  userId: string,
  guildId: string,
  data: { mute?: boolean; deaf?: boolean }
) {
  const [updated] = await db
    .update(schema.voiceStates)
    .set(data)
    .where(and(eq(schema.voiceStates.userId, userId), eq(schema.voiceStates.guildId, guildId)))
    .returning();

  if (!updated) throw new ApiError(404, "User not in a voice channel");
  return updated;
}

export async function getChannelVoiceStates(channelId: string) {
  return db
    .select()
    .from(schema.voiceStates)
    .where(eq(schema.voiceStates.channelId, channelId));
}

export async function getGuildVoiceStates(guildId: string) {
  return db
    .select()
    .from(schema.voiceStates)
    .where(eq(schema.voiceStates.guildId, guildId));
}
