import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { redisPub } from "../config/redis.js";
import { eventRepository } from "../repositories/event.repository.js";
import { guildRepository } from "../repositories/guild.repository.js";

export interface GuildEvent {
  id: string;
  guildId: string;
  channelId: string | null;
  creatorId: string | null;
  name: string;
  description: string | null;
  scheduledStartTime: Date;
  scheduledEndTime: Date | null;
  privacyLevel: number;
  status: number;
  entityType: number;
  entityMetadata: {
    location?: string;
  } | null;
  image: string | null;
  recurrenceRule: {
    frequency: "daily" | "weekly" | "monthly";
    interval?: number;
    byWeekday?: number[];
    count?: number;
    endDate?: string;
  } | null;
  createdAt: Date;
}

export const GuildScheduledEventPrivacyLevel = {
  GUILD_ONLY: 2,
} as const;

export const GuildScheduledEventStatus = {
  SCHEDULED: 1,
  ACTIVE: 2,
  COMPLETED: 3,
  CANCELED: 4,
} as const;

export const GuildScheduledEventEntityType = {
  STAGE_INSTANCE: 1,
  VOICE: 2,
  EXTERNAL: 3,
} as const;

async function dispatchGuild(guildId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  const now = Date.now();
  await Promise.all([
    redisPub.publish(`gateway:guild:${guildId}`, payload),
    redisPub.zadd(`guild_events:${guildId}`, now, `${now}:${payload}`),
    redisPub.zremrangebyscore(`guild_events:${guildId}`, "-inf", now - 60000),
  ]);
}

export async function getGuildEvents(
  guildId: string,
  options?: { after?: Date }
): Promise<GuildEvent[]> {
  if (options?.after) {
    return eventRepository.findByGuildIdAfter(guildId, options.after);
  }
  return eventRepository.findByGuildId(guildId);
}

export async function getEvent(eventId: string): Promise<GuildEvent | null> {
  return eventRepository.findById(eventId);
}

export async function createEvent(
  guildId: string,
  creatorId: string,
  data: {
    name: string;
    description?: string;
    channelId?: string;
    scheduledStartTime: Date;
    scheduledEndTime?: Date;
    privacyLevel?: number;
    entityType: number;
    entityMetadata?: { location?: string };
    image?: string;
  }
): Promise<GuildEvent> {
  const id = generateSnowflake();

  const event = await eventRepository.create({
    id,
    guildId,
    channelId: data.channelId ?? null,
    creatorId,
    name: data.name,
    description: data.description ?? null,
    scheduledStartTime: data.scheduledStartTime,
    scheduledEndTime: data.scheduledEndTime ?? null,
    privacyLevel: data.privacyLevel ?? GuildScheduledEventPrivacyLevel.GUILD_ONLY,
    status: GuildScheduledEventStatus.SCHEDULED,
    entityType: data.entityType,
    entityMetadata: data.entityMetadata ?? null,
    image: data.image ?? null,
  });

  if (!event) {
    throw new ApiError(500, "Failed to create event");
  }

  await dispatchGuild(guildId, "GUILD_SCHEDULED_EVENT_CREATE", event);
  return event;
}

export async function updateEvent(
  eventId: string,
  guildId: string,
  userId: string,
  data: Partial<{
    name: string;
    description: string | null;
    channelId: string | null;
    scheduledStartTime: Date;
    scheduledEndTime: Date | null;
    privacyLevel: number;
    status: number;
    entityType: number;
    entityMetadata: { location?: string } | null;
    image: string | null;
  }>
): Promise<GuildEvent> {
  const existing = await getEvent(eventId);
  if (!existing || existing.guildId !== guildId) {
    throw new ApiError(404, "Event not found");
  }

  // Only creator can update
  if (existing.creatorId !== userId) {
    throw new ApiError(403, "Only the event creator can update this event");
  }

  const event = await eventRepository.update(eventId, data);

  if (!event) {
    throw new ApiError(500, "Failed to update event");
  }

  await dispatchGuild(guildId, "GUILD_SCHEDULED_EVENT_UPDATE", event);
  return event;
}

export async function deleteEvent(
  eventId: string,
  guildId: string,
  userId: string
): Promise<void> {
  const existing = await getEvent(eventId);
  if (!existing || existing.guildId !== guildId) {
    throw new ApiError(404, "Event not found");
  }

  // Check if creator or guild owner
  if (existing.creatorId !== userId) {
    const guild = await guildRepository.findOwnerById(guildId);

    if (!guild || guild.ownerId !== userId) {
      throw new ApiError(403, "Only the event creator or guild owner can delete this event");
    }
  }

  await eventRepository.delete(eventId);

  await dispatchGuild(guildId, "GUILD_SCHEDULED_EVENT_DELETE", { id: eventId, guildId });
}

// ── Event User Management ──

export async function getEventUsers(eventId: string): Promise<string[]> {
  const result = await eventRepository.findUsers(eventId);
  return result.map((r) => r.userId);
}

export async function getEventUserCount(eventId: string): Promise<number> {
  const result = await eventRepository.findUsers(eventId);
  return result.length;
}

export async function addEventUser(
  guildId: string,
  eventId: string,
  userId: string
): Promise<boolean> {
  const event = await getEvent(eventId);
  if (!event || event.guildId !== guildId) {
    throw new ApiError(404, "Event not found");
  }

  try {
    await eventRepository.addUser(eventId, userId);

    await dispatchGuild(guildId, "GUILD_SCHEDULED_EVENT_USER_ADD", {
      guildScheduledEventId: eventId,
      userId,
      guildId,
    });

    return true;
  } catch {
    // Already subscribed
    return false;
  }
}

export async function removeEventUser(
  guildId: string,
  eventId: string,
  userId: string
): Promise<boolean> {
  const event = await getEvent(eventId);
  if (!event || event.guildId !== guildId) {
    throw new ApiError(404, "Event not found");
  }

  const existingUser = await eventRepository.findUser(eventId, userId);

  if (existingUser) {
    await eventRepository.removeUser(eventId, userId);

    await dispatchGuild(guildId, "GUILD_SCHEDULED_EVENT_USER_REMOVE", {
      guildScheduledEventId: eventId,
      userId,
      guildId,
    });

    return true;
  }

  return false;
}

export async function isEventUser(eventId: string, userId: string): Promise<boolean> {
  const result = await eventRepository.findUser(eventId, userId);
  return !!result;
}
