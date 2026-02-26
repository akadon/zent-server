import { ApiError } from "./auth.service.js";
import crypto from "crypto";
import { inviteRepository } from "../repositories/invite.repository.js";
import { memberRepository } from "../repositories/member.repository.js";

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("base64url");
}

export async function createInvite(
  guildId: string,
  channelId: string,
  inviterId: string,
  options?: {
    maxAge?: number;
    maxUses?: number;
    temporary?: boolean;
  }
) {
  const maxAge = options?.maxAge ?? 86400; // 24h
  const code = generateInviteCode();

  const expiresAt =
    maxAge > 0 ? new Date(Date.now() + maxAge * 1000) : null;

  return inviteRepository.create({
    code,
    guildId,
    channelId,
    inviterId,
    maxAge,
    maxUses: options?.maxUses ?? 0,
    temporary: options?.temporary ?? false,
    expiresAt,
  });
}

export async function getInvite(code: string) {
  const invite = await inviteRepository.findByCode(code);

  if (!invite) throw new ApiError(404, "Invite not found or expired");

  // Check expiry
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    await inviteRepository.delete(code);
    throw new ApiError(404, "Invite expired");
  }

  // Check max uses
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    await inviteRepository.delete(code);
    throw new ApiError(404, "Invite max uses reached");
  }

  return invite;
}

export async function useInvite(code: string, userId: string) {
  const invite = await getInvite(code);

  // Check if already a member
  const existing = await memberRepository.findByUserAndGuild(userId, invite.guildId);

  if (existing) {
    return { guildId: invite.guildId, alreadyMember: true };
  }

  // Check ban
  const ban = await memberRepository.findBan(userId, invite.guildId);

  if (ban) throw new ApiError(403, "You are banned from this guild");

  // Add member and increment uses
  await inviteRepository.transaction(async (tx) => {
    await memberRepository.createInTx(tx, {
      userId,
      guildId: invite.guildId,
    });

    await inviteRepository.incrementUsesInTx(tx, code, invite.uses);
  });

  return { guildId: invite.guildId, alreadyMember: false };
}

export async function getGuildInvites(guildId: string) {
  return inviteRepository.findByGuildId(guildId);
}

export async function deleteInvite(code: string) {
  const existing = await inviteRepository.findByCode(code);

  if (!existing) throw new ApiError(404, "Invite not found");

  await inviteRepository.delete(code);
}
