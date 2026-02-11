import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import type { CreateRoleRequest } from "@yxc/types";

export async function createRole(guildId: string, data: CreateRoleRequest) {
  // Get highest position to put new role above @everyone
  const existing = await db
    .select({ position: schema.roles.position })
    .from(schema.roles)
    .where(eq(schema.roles.guildId, guildId));

  const maxPosition = existing.reduce((max, r) => Math.max(max, r.position), 0);

  const id = generateSnowflake();
  const [role] = await db
    .insert(schema.roles)
    .values({
      id,
      guildId,
      name: data.name ?? "new role",
      color: data.color ?? 0,
      hoist: data.hoist ?? false,
      permissions: data.permissions ?? "0",
      mentionable: data.mentionable ?? false,
      position: maxPosition + 1,
    })
    .returning();

  return { ...role!, createdAt: role!.createdAt.toISOString() };
}

export async function getGuildRoles(guildId: string) {
  const roleList = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.guildId, guildId));

  return roleList.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function updateRole(
  roleId: string,
  data: {
    name?: string;
    color?: number;
    hoist?: boolean;
    permissions?: string;
    mentionable?: boolean;
    position?: number;
  }
) {
  const [updated] = await db
    .update(schema.roles)
    .set(data)
    .where(eq(schema.roles.id, roleId))
    .returning();

  if (!updated) throw new ApiError(404, "Role not found");
  return { ...updated, createdAt: updated.createdAt.toISOString() };
}

export async function deleteRole(roleId: string, guildId: string) {
  // Prevent deleting @everyone
  if (roleId === guildId) {
    throw new ApiError(400, "Cannot delete @everyone role");
  }

  // Remove role from all members
  await db.delete(schema.memberRoles).where(eq(schema.memberRoles.roleId, roleId));

  const [deleted] = await db
    .delete(schema.roles)
    .where(eq(schema.roles.id, roleId))
    .returning();

  if (!deleted) throw new ApiError(404, "Role not found");
}

export async function addRoleToMember(
  guildId: string,
  userId: string,
  roleId: string
) {
  await db
    .insert(schema.memberRoles)
    .values({ userId, guildId, roleId })
    .onConflictDoNothing();
}

export async function removeRoleFromMember(
  guildId: string,
  userId: string,
  roleId: string
) {
  await db
    .delete(schema.memberRoles)
    .where(
      and(
        eq(schema.memberRoles.userId, userId),
        eq(schema.memberRoles.guildId, guildId),
        eq(schema.memberRoles.roleId, roleId)
      )
    );
}

export async function getMemberRoles(guildId: string, userId: string) {
  const memberRoleEntries = await db
    .select({ roleId: schema.memberRoles.roleId })
    .from(schema.memberRoles)
    .where(
      and(
        eq(schema.memberRoles.userId, userId),
        eq(schema.memberRoles.guildId, guildId)
      )
    );

  return memberRoleEntries.map((r) => r.roleId);
}
