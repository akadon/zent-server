import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { ApiError } from "./auth.service.js";

export async function addMember(guildId: string, userId: string) {
  // Check if already a member
  const [existing] = await db
    .select()
    .from(schema.members)
    .where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)))
    .limit(1);

  if (existing) return existing;

  // Check if banned
  const [ban] = await db
    .select()
    .from(schema.bans)
    .where(and(eq(schema.bans.guildId, guildId), eq(schema.bans.userId, userId)))
    .limit(1);

  if (ban) throw new ApiError(403, "User is banned from this guild");

  const [member] = await db
    .insert(schema.members)
    .values({ userId, guildId })
    .returning();

  return member!;
}

export async function removeMember(guildId: string, userId: string) {
  const [guild] = await db
    .select({ ownerId: schema.guilds.ownerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (guild?.ownerId === userId) {
    throw new ApiError(400, "Cannot remove the guild owner");
  }

  await db
    .delete(schema.memberRoles)
    .where(and(eq(schema.memberRoles.userId, userId), eq(schema.memberRoles.guildId, guildId)));

  const [removed] = await db
    .delete(schema.members)
    .where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)))
    .returning();

  if (!removed) throw new ApiError(404, "Member not found");
  return removed;
}

export async function getGuildMembers(guildId: string) {
  const memberList = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.guildId, guildId));

  // Get user data and roles for each member
  const result = [];
  for (const m of memberList) {
    const [user] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
        status: schema.users.status,
      })
      .from(schema.users)
      .where(eq(schema.users.id, m.userId))
      .limit(1);

    const memberRoleList = await db
      .select({ roleId: schema.memberRoles.roleId })
      .from(schema.memberRoles)
      .where(
        and(
          eq(schema.memberRoles.userId, m.userId),
          eq(schema.memberRoles.guildId, guildId)
        )
      );

    result.push({
      ...m,
      joinedAt: m.joinedAt.toISOString(),
      premiumSince: m.premiumSince?.toISOString() ?? null,
      communicationDisabledUntil: m.communicationDisabledUntil?.toISOString() ?? null,
      user: user ?? null,
      roles: memberRoleList.map((r) => r.roleId),
    });
  }

  return result;
}

export async function kickMember(guildId: string, targetId: string, kickerId: string) {
  const [guild] = await db
    .select({ ownerId: schema.guilds.ownerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (!guild) throw new ApiError(404, "Guild not found");
  if (targetId === guild.ownerId) throw new ApiError(400, "Cannot kick the guild owner");

  return removeMember(guildId, targetId);
}

export async function banMember(
  guildId: string,
  targetId: string,
  bannedBy: string,
  reason?: string
) {
  const [guild] = await db
    .select({ ownerId: schema.guilds.ownerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (!guild) throw new ApiError(404, "Guild not found");
  if (targetId === guild.ownerId) throw new ApiError(400, "Cannot ban the guild owner");

  // Remove from guild first
  await db
    .delete(schema.memberRoles)
    .where(and(eq(schema.memberRoles.userId, targetId), eq(schema.memberRoles.guildId, guildId)));
  await db
    .delete(schema.members)
    .where(and(eq(schema.members.userId, targetId), eq(schema.members.guildId, guildId)));

  // Create ban record
  await db.insert(schema.bans).values({
    guildId,
    userId: targetId,
    bannedBy,
    reason: reason ?? null,
  });
}

export async function unbanMember(guildId: string, targetId: string) {
  const [ban] = await db
    .delete(schema.bans)
    .where(and(eq(schema.bans.guildId, guildId), eq(schema.bans.userId, targetId)))
    .returning();

  if (!ban) throw new ApiError(404, "Ban not found");
}

export async function getMember(guildId: string, userId: string) {
  const [member] = await db
    .select()
    .from(schema.members)
    .where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)))
    .limit(1);

  if (!member) return null;

  const [user] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      status: schema.users.status,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const memberRoleList = await db
    .select({ roleId: schema.memberRoles.roleId })
    .from(schema.memberRoles)
    .where(
      and(
        eq(schema.memberRoles.userId, userId),
        eq(schema.memberRoles.guildId, guildId)
      )
    );

  return {
    ...member,
    joinedAt: member.joinedAt.toISOString(),
    premiumSince: member.premiumSince?.toISOString() ?? null,
    communicationDisabledUntil: member.communicationDisabledUntil?.toISOString() ?? null,
    user: user ?? null,
    roles: memberRoleList.map((r) => r.roleId),
  };
}
