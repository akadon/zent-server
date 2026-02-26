import { userRepository } from "../repositories/user.repository.js";
import { memberRepository } from "../repositories/member.repository.js";
import { messageRepository } from "../repositories/message.repository.js";
import { relationshipRepository } from "../repositories/relationship.repository.js";
import { readstateRepository } from "../repositories/readstate.repository.js";
import { guildRepository } from "../repositories/guild.repository.js";
import { channelRepository } from "../repositories/channel.repository.js";
import { roleRepository } from "../repositories/role.repository.js";
import { emojiRepository } from "../repositories/emoji.repository.js";

export async function exportUserData(userId: string) {
  const user = await userRepository.findById(userId);
  if (!user) return null;

  const [memberships, messages, relationships, readStates] = await Promise.all([
    memberRepository.findMembershipsByUserId(userId),
    messageRepository.findByAuthorId(userId),
    relationshipRepository.findOutgoingByUserId(userId),
    readstateRepository.findByUserId(userId),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      bio: user.bio,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
    },
    guilds: memberships.map((m) => ({
      ...m,
      joinedAt: m.joinedAt.toISOString(),
    })),
    messages: messages.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
    relationships: relationships.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    readStates,
  };
}

export async function exportGuildData(guildId: string, requesterId: string) {
  const guild = await guildRepository.findById(guildId);
  if (!guild) return null;
  if (guild.ownerId !== requesterId) return null;

  const [channels, roles, members, bans, emojis] = await Promise.all([
    channelRepository.findByGuildId(guildId),
    roleRepository.findByGuildId(guildId),
    memberRepository.findByGuildId(guildId),
    memberRepository.findBansByGuildId(guildId),
    emojiRepository.findByGuildId(guildId),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    guild: {
      ...guild,
      createdAt: guild.createdAt.toISOString(),
      updatedAt: guild.updatedAt.toISOString(),
    },
    channels: channels.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    roles: roles.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    members: members.map((m) => ({
      ...m,
      joinedAt: m.joinedAt.toISOString(),
      premiumSince: m.premiumSince?.toISOString() ?? null,
      communicationDisabledUntil: m.communicationDisabledUntil?.toISOString() ?? null,
    })),
    bans: bans.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    })),
    emojis,
  };
}
