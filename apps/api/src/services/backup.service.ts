import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";

export async function createBackup(guildId: string, userId: string) {
  // Verify owner
  const [guild] = await db
    .select()
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (!guild) throw new ApiError(404, "Guild not found");
  if (guild.ownerId !== userId) throw new ApiError(403, "Only the owner can create backups");

  // Gather all guild data
  const channels = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.guildId, guildId));

  const roles = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.guildId, guildId));

  const emojis = await db
    .select()
    .from(schema.emojis)
    .where(eq(schema.emojis.guildId, guildId));

  const overwrites = [];
  for (const ch of channels) {
    const ow = await db
      .select()
      .from(schema.permissionOverwrites)
      .where(eq(schema.permissionOverwrites.channelId, ch.id));
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
  const [backup] = await db
    .insert(schema.serverBackups)
    .values({
      id,
      guildId,
      createdBy: userId,
      data: backupData,
    })
    .returning();

  return {
    id: backup!.id,
    guildId: backup!.guildId,
    createdBy: backup!.createdBy,
    createdAt: backup!.createdAt.toISOString(),
  };
}

export async function getBackups(guildId: string) {
  const backups = await db
    .select({
      id: schema.serverBackups.id,
      guildId: schema.serverBackups.guildId,
      createdBy: schema.serverBackups.createdBy,
      createdAt: schema.serverBackups.createdAt,
    })
    .from(schema.serverBackups)
    .where(eq(schema.serverBackups.guildId, guildId))
    .orderBy(desc(schema.serverBackups.createdAt));

  return backups.map((b) => ({
    ...b,
    createdAt: b.createdAt.toISOString(),
  }));
}

export async function getBackup(id: string) {
  const [backup] = await db
    .select()
    .from(schema.serverBackups)
    .where(eq(schema.serverBackups.id, id))
    .limit(1);

  if (!backup) throw new ApiError(404, "Backup not found");

  return {
    ...backup,
    createdAt: backup.createdAt.toISOString(),
  };
}

export async function deleteBackup(id: string, userId: string) {
  const [backup] = await db
    .select()
    .from(schema.serverBackups)
    .where(eq(schema.serverBackups.id, id))
    .limit(1);

  if (!backup) throw new ApiError(404, "Backup not found");

  // Verify guild owner
  const [guild] = await db
    .select({ ownerId: schema.guilds.ownerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, backup.guildId))
    .limit(1);

  if (!guild || guild.ownerId !== userId) {
    throw new ApiError(403, "Only the owner can delete backups");
  }

  await db.delete(schema.serverBackups).where(eq(schema.serverBackups.id, id));
}
