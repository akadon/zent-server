import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

export async function createBanAppeal(guildId: string, userId: string, reason: string) {
  // Verify user is actually banned
  const [ban] = await db
    .select()
    .from(schema.bans)
    .where(and(eq(schema.bans.guildId, guildId), eq(schema.bans.userId, userId)))
    .limit(1);

  if (!ban) throw new ApiError(400, "You are not banned from this guild");

  // Check for existing pending appeal
  const [existing] = await db
    .select()
    .from(schema.banAppeals)
    .where(
      and(
        eq(schema.banAppeals.guildId, guildId),
        eq(schema.banAppeals.userId, userId),
        eq(schema.banAppeals.status, "pending")
      )
    )
    .limit(1);

  if (existing) throw new ApiError(400, "You already have a pending appeal");

  const id = generateSnowflake();
  const [appeal] = await db
    .insert(schema.banAppeals)
    .values({ id, guildId, userId, reason })
    .returning();

  return {
    ...appeal!,
    createdAt: appeal!.createdAt.toISOString(),
    resolvedAt: appeal!.resolvedAt?.toISOString() ?? null,
  };
}

export async function getGuildAppeals(guildId: string) {
  const appeals = await db
    .select()
    .from(schema.banAppeals)
    .where(eq(schema.banAppeals.guildId, guildId))
    .orderBy(desc(schema.banAppeals.createdAt));

  return appeals.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
  }));
}

export async function resolveAppeal(
  appealId: string,
  moderatorId: string,
  status: "accepted" | "rejected",
  moderatorReason?: string
) {
  const [appeal] = await db
    .select()
    .from(schema.banAppeals)
    .where(eq(schema.banAppeals.id, appealId))
    .limit(1);

  if (!appeal) throw new ApiError(404, "Appeal not found");
  if (appeal.status !== "pending") throw new ApiError(400, "Appeal already resolved");

  // Verify moderator is guild owner (simplified check)
  const [guild] = await db
    .select({ ownerId: schema.guilds.ownerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, appeal.guildId))
    .limit(1);

  if (!guild || guild.ownerId !== moderatorId) {
    throw new ApiError(403, "Missing permissions");
  }

  const [updated] = await db
    .update(schema.banAppeals)
    .set({
      status,
      moderatorId,
      moderatorReason: moderatorReason ?? null,
      resolvedAt: new Date(),
    })
    .where(eq(schema.banAppeals.id, appealId))
    .returning();

  // If accepted, remove the ban
  if (status === "accepted") {
    await db
      .delete(schema.bans)
      .where(
        and(eq(schema.bans.guildId, appeal.guildId), eq(schema.bans.userId, appeal.userId))
      );
  }

  return {
    ...updated!,
    createdAt: updated!.createdAt.toISOString(),
    resolvedAt: updated!.resolvedAt?.toISOString() ?? null,
  };
}
