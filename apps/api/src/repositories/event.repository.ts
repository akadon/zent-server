import { eq, and, gte, asc, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const eventRepository = {
  async findById(id: string) {
    const [event] = await db.select().from(schema.guildEvents).where(eq(schema.guildEvents.id, id)).limit(1);
    return event ?? null;
  },
  async findByGuildId(guildId: string) {
    return db
      .select()
      .from(schema.guildEvents)
      .where(eq(schema.guildEvents.guildId, guildId))
      .orderBy(asc(schema.guildEvents.scheduledStartTime));
  },
  async findByGuildIdAfter(guildId: string, after: Date) {
    return db
      .select()
      .from(schema.guildEvents)
      .where(
        and(
          eq(schema.guildEvents.guildId, guildId),
          gte(schema.guildEvents.scheduledStartTime, after),
        ),
      )
      .orderBy(asc(schema.guildEvents.scheduledStartTime));
  },
  async findUser(eventId: string, userId: string) {
    const [row] = await db
      .select()
      .from(schema.guildEventUsers)
      .where(
        and(
          eq(schema.guildEventUsers.eventId, eventId),
          eq(schema.guildEventUsers.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  },
  async create(data: {
    id: string;
    guildId: string;
    channelId?: string | null;
    creatorId?: string | null;
    name: string;
    description?: string | null;
    image?: string | null;
    scheduledStartTime: Date;
    scheduledEndTime?: Date | null;
    privacyLevel?: number;
    status?: number;
    entityType?: number;
    entityMetadata?: { location?: string } | null;
    recurrenceRule?: {
      frequency: "daily" | "weekly" | "monthly";
      interval?: number;
      byWeekday?: number[];
      count?: number;
      endDate?: string;
    } | null;
  }) {
    await db.insert(schema.guildEvents).values(data);
    return (await db.select().from(schema.guildEvents).where(eq(schema.guildEvents.id, data.id)).limit(1))[0]!;
  },
  async update(id: string, data: Partial<{
    name: string;
    description: string | null;
    image: string | null;
    channelId: string | null;
    scheduledStartTime: Date;
    scheduledEndTime: Date | null;
    privacyLevel: number;
    status: number;
    entityType: number;
    entityMetadata: { location?: string } | null;
    recurrenceRule: {
      frequency: "daily" | "weekly" | "monthly";
      interval?: number;
      byWeekday?: number[];
      count?: number;
      endDate?: string;
    } | null;
  }>) {
    await db.update(schema.guildEvents).set(data).where(eq(schema.guildEvents.id, id));
    return (await db.select().from(schema.guildEvents).where(eq(schema.guildEvents.id, id)).limit(1))[0]!;
  },
  async delete(id: string) {
    await db.delete(schema.guildEvents).where(eq(schema.guildEvents.id, id));
  },
  async addUser(eventId: string, userId: string, status?: "interested" | "going" | "not_going") {
    await db
      .insert(schema.guildEventUsers)
      .values({ eventId, userId, status: status ?? "interested" })
      .onDuplicateKeyUpdate({
        set: { status: status ?? "interested" },
      });
  },
  async removeUser(eventId: string, userId: string) {
    await db
      .delete(schema.guildEventUsers)
      .where(
        and(
          eq(schema.guildEventUsers.eventId, eventId),
          eq(schema.guildEventUsers.userId, userId),
        ),
      );
  },
  async findUsers(eventId: string) {
    return db
      .select()
      .from(schema.guildEventUsers)
      .where(eq(schema.guildEventUsers.eventId, eventId));
  },
  async findUsersByEventIds(eventIds: string[]) {
    if (eventIds.length === 0) return [];
    return db
      .select({ eventId: schema.guildEventUsers.eventId, userId: schema.guildEventUsers.userId })
      .from(schema.guildEventUsers)
      .where(inArray(schema.guildEventUsers.eventId, eventIds));
  },
};
