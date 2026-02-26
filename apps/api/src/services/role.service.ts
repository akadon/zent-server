import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import type { CreateRoleRequest } from "@yxc/types";
import { invalidateGuildPermissions, invalidatePermissions } from "./permission.service.js";
import { roleRepository } from "../repositories/role.repository.js";

export async function createRole(guildId: string, data: CreateRoleRequest) {
  // Get highest position to put new role above @everyone
  const existing = await roleRepository.findByGuildId(guildId);
  const maxPosition = existing.reduce((max, r) => Math.max(max, r.position), 0);

  const id = generateSnowflake();
  const role = await roleRepository.create({
    id,
    guildId,
    name: data.name ?? "new role",
    color: data.color ?? 0,
    hoist: data.hoist ?? false,
    permissions: data.permissions ?? "0",
    mentionable: data.mentionable ?? false,
    position: maxPosition + 1,
  });

  return { ...role, createdAt: role.createdAt.toISOString() };
}

export async function getGuildRoles(guildId: string) {
  const roleList = await roleRepository.findByGuildId(guildId);

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
  const updated = await roleRepository.update(roleId, data);

  if (!updated) throw new ApiError(404, "Role not found");

  if (data.permissions !== undefined) {
    await invalidateGuildPermissions(updated.guildId);
  }

  return { ...updated, createdAt: updated.createdAt.toISOString() };
}

export async function deleteRole(roleId: string, guildId: string) {
  if (roleId === guildId) {
    throw new ApiError(400, "Cannot delete @everyone role");
  }

  const existing = await roleRepository.findById(roleId);
  if (!existing) throw new ApiError(404, "Role not found");

  await roleRepository.delete(roleId);

  await invalidateGuildPermissions(guildId);
}

export async function addRoleToMember(
  guildId: string,
  userId: string,
  roleId: string
) {
  await roleRepository.addToMember(userId, guildId, roleId);

  await invalidatePermissions(userId, guildId);
}

export async function removeRoleFromMember(
  guildId: string,
  userId: string,
  roleId: string
) {
  await roleRepository.removeFromMember(userId, guildId, roleId);

  await invalidatePermissions(userId, guildId);
}

export async function getMemberRoles(guildId: string, userId: string) {
  return roleRepository.getMemberRoleIds(userId, guildId);
}
