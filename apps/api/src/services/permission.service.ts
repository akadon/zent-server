import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { computePermissions, PermissionsBitfield, type PermissionOverwrite, type RolePermission } from "@yxc/permissions";
import { ApiError } from "./auth.service.js";

/**
 * Get effective permissions for a user in a guild (no channel context).
 */
export async function getGuildPermissions(
  userId: string,
  guildId: string
): Promise<PermissionsBitfield> {
  const [guild] = await db
    .select({ ownerId: schema.guilds.ownerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (!guild) throw new ApiError(404, "Guild not found");

  // Get @everyone role
  const [everyoneRole] = await db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.guildId, guildId), eq(schema.roles.name, "@everyone")))
    .limit(1);

  if (!everyoneRole) throw new ApiError(500, "Missing @everyone role");

  // Get member's roles
  const memberRoleRecords = await db
    .select({ roleId: schema.memberRoles.roleId })
    .from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.userId, userId), eq(schema.memberRoles.guildId, guildId)));

  const roleIds = memberRoleRecords.map((r) => r.roleId);
  let memberRoles: RolePermission[] = [];
  if (roleIds.length > 0) {
    const allRoles = await db.select().from(schema.roles).where(eq(schema.roles.guildId, guildId));
    memberRoles = allRoles
      .filter((r) => roleIds.includes(r.id))
      .map((r) => ({ id: r.id, permissions: BigInt(r.permissions), position: r.position }));
  }

  return computePermissions({
    userId,
    guildOwnerId: guild.ownerId,
    everyoneRole: {
      id: everyoneRole.id,
      permissions: BigInt(everyoneRole.permissions),
      position: everyoneRole.position,
    },
    memberRoles,
  });
}

/**
 * Get effective permissions for a user in a specific channel.
 */
export async function getChannelPermissions(
  userId: string,
  guildId: string,
  channelId: string
): Promise<PermissionsBitfield> {
  const [guild] = await db
    .select({ ownerId: schema.guilds.ownerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (!guild) throw new ApiError(404, "Guild not found");

  const [everyoneRole] = await db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.guildId, guildId), eq(schema.roles.name, "@everyone")))
    .limit(1);

  if (!everyoneRole) throw new ApiError(500, "Missing @everyone role");

  const memberRoleRecords = await db
    .select({ roleId: schema.memberRoles.roleId })
    .from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.userId, userId), eq(schema.memberRoles.guildId, guildId)));

  const roleIds = memberRoleRecords.map((r) => r.roleId);
  const allRoles = await db.select().from(schema.roles).where(eq(schema.roles.guildId, guildId));
  const memberRoles: RolePermission[] = allRoles
    .filter((r) => roleIds.includes(r.id))
    .map((r) => ({ id: r.id, permissions: BigInt(r.permissions), position: r.position }));

  // Get channel overwrites
  const overwrites = await db
    .select()
    .from(schema.permissionOverwrites)
    .where(eq(schema.permissionOverwrites.channelId, channelId));

  const channelOverwrites: PermissionOverwrite[] = overwrites.map((o) => ({
    id: o.targetId,
    type: o.targetType as 0 | 1,
    allow: BigInt(o.allow),
    deny: BigInt(o.deny),
  }));

  return computePermissions({
    userId,
    guildOwnerId: guild.ownerId,
    everyoneRole: {
      id: everyoneRole.id,
      permissions: BigInt(everyoneRole.permissions),
      position: everyoneRole.position,
    },
    memberRoles,
    channelOverwrites,
  });
}

/**
 * Check that a user has the required guild-level permission, throw 403 if not.
 */
export async function requireGuildPermission(
  userId: string,
  guildId: string,
  permission: bigint
): Promise<void> {
  const perms = await getGuildPermissions(userId, guildId);
  if (!perms.has(permission)) {
    throw new ApiError(403, "Missing permissions");
  }
}

/**
 * Check that a user has the required channel-level permission, throw 403 if not.
 */
export async function requireChannelPermission(
  userId: string,
  guildId: string,
  channelId: string,
  permission: bigint
): Promise<void> {
  const perms = await getChannelPermissions(userId, guildId, channelId);
  if (!perms.has(permission)) {
    throw new ApiError(403, "Missing permissions");
  }
}

// ── Permission Overwrites CRUD ──

export async function setPermissionOverwrite(
  channelId: string,
  targetId: string,
  targetType: 0 | 1,
  allow: string,
  deny: string
) {
  const existing = await db
    .select()
    .from(schema.permissionOverwrites)
    .where(
      and(
        eq(schema.permissionOverwrites.channelId, channelId),
        eq(schema.permissionOverwrites.targetId, targetId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.permissionOverwrites)
      .set({ allow, deny, targetType })
      .where(
        and(
          eq(schema.permissionOverwrites.channelId, channelId),
          eq(schema.permissionOverwrites.targetId, targetId)
        )
      );
  } else {
    await db.insert(schema.permissionOverwrites).values({
      channelId,
      targetId,
      targetType,
      allow,
      deny,
    });
  }

  return { channelId, targetId, targetType, allow, deny };
}

export async function deletePermissionOverwrite(channelId: string, targetId: string) {
  await db
    .delete(schema.permissionOverwrites)
    .where(
      and(
        eq(schema.permissionOverwrites.channelId, channelId),
        eq(schema.permissionOverwrites.targetId, targetId)
      )
    );
}

export async function getChannelOverwrites(channelId: string) {
  return db
    .select()
    .from(schema.permissionOverwrites)
    .where(eq(schema.permissionOverwrites.channelId, channelId));
}
