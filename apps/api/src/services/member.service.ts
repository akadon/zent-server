import { ApiError } from "./auth.service.js";
import { memberRepository } from "../repositories/member.repository.js";
import { guildRepository } from "../repositories/guild.repository.js";
import { userRepository } from "../repositories/user.repository.js";

export async function addMember(guildId: string, userId: string) {
  // Check if already a member
  const existing = await memberRepository.findByUserAndGuild(userId, guildId);
  if (existing) return existing;

  // Check if banned
  const ban = await memberRepository.findBan(userId, guildId);
  if (ban) throw new ApiError(403, "User is banned from this guild");

  await memberRepository.create({ userId, guildId });

  const member = await memberRepository.findByUserAndGuild(userId, guildId);
  return member!;
}

export async function removeMember(guildId: string, userId: string) {
  const guild = await guildRepository.findOwnerById(guildId);

  if (guild?.ownerId === userId) {
    throw new ApiError(400, "Cannot remove the guild owner");
  }

  const removed = await memberRepository.findByUserAndGuild(userId, guildId);
  if (!removed) throw new ApiError(404, "Member not found");

  await memberRepository.deleteMemberRoles(userId, guildId);
  await memberRepository.delete(userId, guildId);

  return removed;
}

export async function getGuildMembers(guildId: string, limit: number = 1000) {
  const memberList = await memberRepository.findByGuildIdWithLimit(guildId, limit);
  if (memberList.length === 0) return [];

  const userIds = memberList.map((m) => m.userId);

  // Batch fetch users and member roles for these members only (not entire guild)
  const [userList, allMemberRoles] = await Promise.all([
    userRepository.findPublicByIds(userIds),
    memberRepository.getMemberRolesByGuildAndUserIds(guildId, userIds),
  ]);

  const userMap = new Map(userList.map((u) => [u.id, u]));

  const roleMap = new Map<string, string[]>();
  for (const mr of allMemberRoles) {
    const existing = roleMap.get(mr.userId) ?? [];
    existing.push(mr.roleId);
    roleMap.set(mr.userId, existing);
  }

  return memberList.map((m) => ({
    ...m,
    joinedAt: m.joinedAt.toISOString(),
    premiumSince: m.premiumSince?.toISOString() ?? null,
    communicationDisabledUntil: m.communicationDisabledUntil?.toISOString() ?? null,
    user: userMap.get(m.userId) ?? null,
    roles: roleMap.get(m.userId) ?? [],
  }));
}

export async function kickMember(guildId: string, targetId: string, kickerId: string) {
  const guild = await guildRepository.findOwnerById(guildId);
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
  const guild = await guildRepository.findOwnerById(guildId);
  if (!guild) throw new ApiError(404, "Guild not found");
  if (targetId === guild.ownerId) throw new ApiError(400, "Cannot ban the guild owner");

  // Remove from guild first
  await memberRepository.deleteMemberRoles(targetId, guildId);
  await memberRepository.delete(targetId, guildId);

  // Create ban record
  await memberRepository.createBan({
    guildId,
    userId: targetId,
    bannedBy,
    reason: reason ?? null,
  });
}

export async function unbanMember(guildId: string, targetId: string) {
  const ban = await memberRepository.findBan(targetId, guildId);
  if (!ban) throw new ApiError(404, "Ban not found");

  await memberRepository.deleteBan(targetId, guildId);
}

export async function getMember(guildId: string, userId: string) {
  const member = await memberRepository.findByUserAndGuild(userId, guildId);
  if (!member) return null;

  const [user, memberRoleList] = await Promise.all([
    userRepository.findPublicById(userId),
    memberRepository.getMemberRoleIds(userId, guildId),
  ]);

  return {
    ...member,
    joinedAt: member.joinedAt.toISOString(),
    premiumSince: member.premiumSince?.toISOString() ?? null,
    communicationDisabledUntil: member.communicationDisabledUntil?.toISOString() ?? null,
    user: user ?? null,
    roles: memberRoleList.map((r) => r.roleId),
  };
}
