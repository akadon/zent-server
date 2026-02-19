import { eq, and, gte, asc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { redisPub } from "../config/redis.js";

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
  await redisPub.publish(
    `gateway:guild:${guildId}`,
    JSON.stringify({ event, data })
  );
}

export async function getGuildEvents(
  guildId: string,
  options?: { after?: Date }
): Promise<GuildEvent[]> {
  let query = db
    .select()
    .from(schema.guildEvents)
    .where(eq(schema.guildEvents.guildId, guildId))
    .orderBy(asc(schema.guildEvents.scheduledStartTime));

  if (options?.after) {
    query = db
      .select()
      .from(schema.guildEvents)
      .where(
        and(
          eq(schema.guildEvents.guildId, guildId),
          gte(schema.guildEvents.scheduledStartTime, options.after)
        )
      )
      .orderBy(asc(schema.guildEvents.scheduledStartTime));
  }

  return query;
}

export async function getEvent(eventId: string): Promise<GuildEvent | null> {
  const [event] = await db
    .select()
    .from(schema.guildEvents)
    .where(eq(schema.guildEvents.id, eventId))
    .limit(1);

  return event ?? null;
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

  await db
    .insert(schema.guildEvents)
    .values({
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

  const [event] = await db
    .select()
    .from(schema.guildEvents)
    .where(eq(schema.guildEvents.id, id))
    .limit(1);

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

  await db
    .update(schema.guildEvents)
    .set(data)
    .where(eq(schema.guildEvents.id, eventId));

  const [event] = await db
    .select()
    .from(schema.guildEvents)
    .where(eq(schema.guildEvents.id, eventId))
    .limit(1);

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
    const [guild] = await db
      .select({ ownerId: schema.guilds.ownerId })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, guildId))
      .limit(1);

    if (!guild || guild.ownerId !== userId) {
      throw new ApiError(403, "Only the event creator or guild owner can delete this event");
    }
  }

  await db
    .delete(schema.guildEvents)
    .where(eq(schema.guildEvents.id, eventId));

  await dispatchGuild(guildId, "GUILD_SCHEDULED_EVENT_DELETE", { id: eventId, guildId });
}

// ── Event User Management ──

export async function getEventUsers(eventId: string): Promise<string[]> {
  const result = await db
    .select({ userId: schema.guildEventUsers.userId })
    .from(schema.guildEventUsers)
    .where(eq(schema.guildEventUsers.eventId, eventId));

  return result.map((r) => r.userId);
}

export async function getEventUserCount(eventId: string): Promise<number> {
  const result = await db
    .select({ userId: schema.guildEventUsers.userId })
    .from(schema.guildEventUsers)
    .where(eq(schema.guildEventUsers.eventId, eventId));

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
    await db.insert(schema.guildEventUsers).values({
      eventId,
      userId,
    });

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

  const [existingUser] = await db
    .select()
    .from(schema.guildEventUsers)
    .where(
      and(
        eq(schema.guildEventUsers.eventId, eventId),
        eq(schema.guildEventUsers.userId, userId)
      )
    )
    .limit(1);

  if (existingUser) {
    await db
      .delete(schema.guildEventUsers)
      .where(
        and(
          eq(schema.guildEventUsers.eventId, eventId),
          eq(schema.guildEventUsers.userId, userId)
        )
      );

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
  const [result] = await db
    .select({ userId: schema.guildEventUsers.userId })
    .from(schema.guildEventUsers)
    .where(
      and(
        eq(schema.guildEventUsers.eventId, eventId),
        eq(schema.guildEventUsers.userId, userId)
      )
    )
    .limit(1);

  return !!result;
}
