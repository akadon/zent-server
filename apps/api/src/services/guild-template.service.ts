import { eq } from "drizzle-orm";
import { db, schema, SerializedGuild } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import * as guildService from "./guild.service.js";
import * as channelService from "./channel.service.js";
import * as roleService from "./role.service.js";
import crypto from "crypto";

export interface GuildTemplate {
  code: string;
  guildId: string;
  name: string;
  description: string | null;
  usageCount: number;
  creatorId: string;
  serializedGuild: SerializedGuild;
  createdAt: Date;
  updatedAt: Date;
  isDirty: boolean;
}

// Generate a unique template code
function generateTemplateCode(): string {
  return crypto.randomBytes(8).toString("base64url");
}

// Serialize a guild for template storage
async function serializeGuild(guildId: string): Promise<SerializedGuild> {
  const guild = await guildService.getGuild(guildId);
  if (!guild) throw new ApiError(404, "Guild not found");

  const channels = await channelService.getGuildChannels(guildId);
  const roles = await roleService.getGuildRoles(guildId);

  // Get permission overwrites for each channel
  const channelsWithOverwrites = await Promise.all(
    channels.map(async (channel) => {
      const overwrites = await db
        .select()
        .from(schema.permissionOverwrites)
        .where(eq(schema.permissionOverwrites.channelId, channel.id));

      return {
        id: channel.id,
        name: channel.name ?? "",
        type: channel.type,
        topic: channel.topic ?? undefined,
        position: channel.position,
        parentId: channel.parentId ?? undefined,
        nsfw: channel.nsfw,
        rateLimitPerUser: channel.rateLimitPerUser,
        bitrate: channel.bitrate ?? undefined,
        userLimit: channel.userLimit ?? undefined,
        permissionOverwrites: overwrites.map((o) => ({
          id: o.targetId,
          type: o.targetType,
          allow: o.allow,
          deny: o.deny,
        })),
      };
    })
  );

  return {
    name: guild.name,
    icon: guild.icon ?? undefined,
    description: guild.description ?? undefined,
    verificationLevel: guild.verificationLevel,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    explicitContentFilter: guild.explicitContentFilter,
    preferredLocale: guild.preferredLocale,
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      position: r.position,
      permissions: r.permissions,
      mentionable: r.mentionable,
    })),
    channels: channelsWithOverwrites,
    systemChannelId: guild.systemChannelId ?? undefined,
  };
}

// Create a template from a guild
export async function createTemplate(
  guildId: string,
  name: string,
  description: string | null,
  creatorId: string
): Promise<GuildTemplate> {
  // Check if guild already has a template
  const existing = await getGuildTemplate(guildId);
  if (existing) {
    throw new ApiError(400, "Guild already has a template");
  }

  const code = generateTemplateCode();
  const serializedGuild = await serializeGuild(guildId);

  const [template] = await db
    .insert(schema.guildTemplates)
    .values({
      code,
      guildId,
      name,
      description,
      creatorId,
      serializedGuild,
    })
    .returning();

  if (!template) {
    throw new ApiError(500, "Failed to create template");
  }

  return template;
}

// Get a template by code
export async function getTemplate(code: string): Promise<GuildTemplate | null> {
  const [template] = await db
    .select()
    .from(schema.guildTemplates)
    .where(eq(schema.guildTemplates.code, code))
    .limit(1);

  return template ?? null;
}

// Get a guild's template
export async function getGuildTemplate(guildId: string): Promise<GuildTemplate | null> {
  const [template] = await db
    .select()
    .from(schema.guildTemplates)
    .where(eq(schema.guildTemplates.guildId, guildId))
    .limit(1);

  return template ?? null;
}

// Sync a template with its source guild
export async function syncTemplate(code: string): Promise<GuildTemplate> {
  const template = await getTemplate(code);
  if (!template) {
    throw new ApiError(404, "Template not found");
  }

  const serializedGuild = await serializeGuild(template.guildId);

  await db
    .update(schema.guildTemplates)
    .set({
      serializedGuild,
      updatedAt: new Date(),
      isDirty: false,
    })
    .where(eq(schema.guildTemplates.code, code));

  return (await getTemplate(code))!;
}

// Update a template
export async function updateTemplate(
  code: string,
  updates: { name?: string; description?: string | null }
): Promise<GuildTemplate> {
  const template = await getTemplate(code);
  if (!template) {
    throw new ApiError(404, "Template not found");
  }

  await db
    .update(schema.guildTemplates)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(schema.guildTemplates.code, code));

  return (await getTemplate(code))!;
}

// Delete a template
export async function deleteTemplate(code: string): Promise<void> {
  await db.delete(schema.guildTemplates).where(eq(schema.guildTemplates.code, code));
}

// Create a guild from a template
export async function createGuildFromTemplate(
  code: string,
  name: string,
  ownerId: string,
  icon?: string
): Promise<{ guildId: string }> {
  const template = await getTemplate(code);
  if (!template) {
    throw new ApiError(404, "Template not found");
  }

  // Create the guild with basic info
  const guild = await guildService.createGuild(ownerId, name, icon);
  if (!guild) {
    throw new ApiError(500, "Failed to create guild");
  }

  // Apply template settings
  await db
    .update(schema.guilds)
    .set({
      verificationLevel: template.serializedGuild.verificationLevel,
      defaultMessageNotifications: template.serializedGuild.defaultMessageNotifications,
      explicitContentFilter: template.serializedGuild.explicitContentFilter,
      preferredLocale: template.serializedGuild.preferredLocale,
    })
    .where(eq(schema.guilds.id, guild.id));

  // Create ID mapping for roles and channels
  const roleIdMap = new Map<string, string>();
  const channelIdMap = new Map<string, string>();

  // Create roles (skip @everyone which already exists)
  for (const roleData of template.serializedGuild.roles) {
    if (roleData.id === template.guildId) {
      // @everyone role - map to new guild's @everyone (same as guild ID)
      roleIdMap.set(roleData.id, guild.id);

      // Update @everyone permissions
      await db
        .update(schema.roles)
        .set({ permissions: roleData.permissions })
        .where(eq(schema.roles.id, guild.id));
    } else {
      const newRole = await roleService.createRole(guild.id, {
        name: roleData.name,
        color: roleData.color,
        hoist: roleData.hoist,
        permissions: roleData.permissions,
        mentionable: roleData.mentionable,
      });
      roleIdMap.set(roleData.id, newRole.id);
    }
  }

  // Delete default channels created by createGuild
  const defaultChannels = await channelService.getGuildChannels(guild.id);
  for (const ch of defaultChannels) {
    await channelService.deleteChannel(ch.id);
  }

  // Create channels (categories first, then others)
  type SerializedChannel = SerializedGuild["channels"][number];
  const categories = template.serializedGuild.channels.filter((c: SerializedChannel) => c.type === 4);
  const nonCategories = template.serializedGuild.channels.filter((c: SerializedChannel) => c.type !== 4);

  // Create categories first
  for (const channelData of categories) {
    const newChannel = await channelService.createChannel(guild.id, {
      name: channelData.name,
      type: channelData.type,
      topic: channelData.topic,
      position: channelData.position,
      nsfw: channelData.nsfw,
      rateLimitPerUser: channelData.rateLimitPerUser,
    });
    channelIdMap.set(channelData.id, newChannel.id);
  }

  // Create other channels
  for (const channelData of nonCategories) {
    const parentId = channelData.parentId ? channelIdMap.get(channelData.parentId) : undefined;
    const newChannel = await channelService.createChannel(guild.id, {
      name: channelData.name,
      type: channelData.type,
      topic: channelData.topic,
      position: channelData.position,
      parentId,
      nsfw: channelData.nsfw,
      rateLimitPerUser: channelData.rateLimitPerUser,
      bitrate: channelData.bitrate,
      userLimit: channelData.userLimit,
    });
    channelIdMap.set(channelData.id, newChannel.id);

    // Create permission overwrites
    if (channelData.permissionOverwrites) {
      for (const overwrite of channelData.permissionOverwrites) {
        // Map old role/channel ID to new ID
        const targetId = roleIdMap.get(overwrite.id) ?? overwrite.id;
        await db.insert(schema.permissionOverwrites).values({
          channelId: newChannel.id,
          targetId,
          targetType: overwrite.type,
          allow: overwrite.allow,
          deny: overwrite.deny,
        });
      }
    }
  }

  // Update system channel ID if it was set
  if (template.serializedGuild.systemChannelId) {
    const newSystemChannelId = channelIdMap.get(template.serializedGuild.systemChannelId);
    if (newSystemChannelId) {
      await db
        .update(schema.guilds)
        .set({ systemChannelId: newSystemChannelId })
        .where(eq(schema.guilds.id, guild.id));
    }
  }

  // Increment usage count
  await db
    .update(schema.guildTemplates)
    .set({ usageCount: template.usageCount + 1 })
    .where(eq(schema.guildTemplates.code, code));

  return { guildId: guild.id };
}
