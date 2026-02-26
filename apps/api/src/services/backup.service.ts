import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { backupRepository } from "../repositories/backup.repository.js";
import { guildRepository } from "../repositories/guild.repository.js";
import { channelRepository } from "../repositories/channel.repository.js";
import { roleRepository } from "../repositories/role.repository.js";
import { emojiRepository } from "../repositories/emoji.repository.js";
import { permissionRepository } from "../repositories/permission.repository.js";

export async function createBackup(guildId: string, userId: string) {
  // Verify owner
  const guild = await guildRepository.findById(guildId);
  if (!guild) throw new ApiError(404, "Guild not found");
  if (guild.ownerId !== userId) throw new ApiError(403, "Only the owner can create backups");

  // Gather all guild data
  const [channels, roles, emojis] = await Promise.all([
    channelRepository.findByGuildId(guildId),
    roleRepository.findByGuildId(guildId),
    emojiRepository.findByGuildId(guildId),
  ]);

  const overwrites = [];
  for (const ch of channels) {
    const ow = await permissionRepository.findOverwritesByChannelId(ch.id);
    overwrites.push(...ow);
  }

  const backupData = {
    guild: {
      name: guild.name,
      icon: guild.icon,
      banner: guild.banner,
      splash: guild.splash,
      description: guild.description,
      verificationLevel: guild.verificationLevel,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      explicitContentFilter: guild.explicitContentFilter,
      features: guild.features,
      preferredLocale: guild.preferredLocale,
    },
    channels: channels.map((c) => ({
      name: c.name,
      type: c.type,
      topic: c.topic,
      position: c.position,
      parentId: c.parentId,
      nsfw: c.nsfw,
      rateLimitPerUser: c.rateLimitPerUser,
      bitrate: c.bitrate,
      userLimit: c.userLimit,
      messageRetentionSeconds: c.messageRetentionSeconds,
    })),
    roles: roles.map((r) => ({
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      position: r.position,
      permissions: r.permissions,
      mentionable: r.mentionable,
    })),
    emojis: emojis.map((e) => ({
      name: e.name,
      animated: e.animated,
    })),
    permissionOverwrites: overwrites.map((o) => ({
      targetId: o.targetId,
      targetType: o.targetType,
      allow: o.allow,
      deny: o.deny,
    })),
  };

  const id = generateSnowflake();
  const backup = await backupRepository.create({
    id,
    guildId,
    createdBy: userId,
    data: backupData,
  });

  return {
    id: backup.id,
    guildId: backup.guildId,
    createdBy: backup.createdBy,
    createdAt: backup.createdAt.toISOString(),
  };
}

export async function getBackups(guildId: string) {
  const backups = await backupRepository.findByGuildId(guildId);

  return backups.map((b) => ({
    ...b,
    createdAt: b.createdAt.toISOString(),
  }));
}

export async function getBackup(id: string) {
  const backup = await backupRepository.findById(id);
  if (!backup) throw new ApiError(404, "Backup not found");

  return {
    ...backup,
    createdAt: backup.createdAt.toISOString(),
  };
}

export async function deleteBackup(id: string, userId: string) {
  const backup = await backupRepository.findById(id);
  if (!backup) throw new ApiError(404, "Backup not found");

  // Verify guild owner
  const guild = await guildRepository.findOwnerById(backup.guildId);
  if (!guild || guild.ownerId !== userId) {
    throw new ApiError(403, "Only the owner can delete backups");
  }

  await backupRepository.delete(id);
}
