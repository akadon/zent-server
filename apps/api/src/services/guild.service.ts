import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { DEFAULT_PERMISSIONS } from "@yxc/permissions";
import { ApiError } from "./auth.service.js";
import { ChannelType } from "@yxc/types";

export async function createGuild(ownerId: string, name: string, icon?: string) {
  const guildId = generateSnowflake();
  const everyoneRoleId = guildId; // @everyone role ID = guild ID (Discord convention)
  const generalChannelId = generateSnowflake();
  const voiceChannelId = generateSnowflake();

  await db.transaction(async (tx) => {
    // Create guild
    await tx.insert(schema.guilds).values({
      id: guildId,
      name,
      icon: icon ?? null,
      ownerId,
      systemChannelId: generalChannelId,
    });

    // Create @everyone role
    await tx.insert(schema.roles).values({
      id: everyoneRoleId,
      guildId,
      name: "@everyone",
      permissions: DEFAULT_PERMISSIONS.toString(),
      position: 0,
    });

    // Create default channels
    await tx.insert(schema.channels).values([
      {
        id: generalChannelId,
        guildId,
        type: ChannelType.GUILD_TEXT,
        name: "general",
        position: 0,
      },
      {
        id: voiceChannelId,
        guildId,
        type: ChannelType.GUILD_VOICE,
        name: "General",
        position: 1,
      },
    ]);

    // Add owner as member
    await tx.insert(schema.members).values({
      userId: ownerId,
      guildId,
    });
  });

  return getGuild(guildId);
}

export async function getGuild(guildId: string) {
  const [guild] = await db
    .select()
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (!guild) return null;

  const guildChannels = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.guildId, guildId));

  const guildRoles = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.guildId, guildId));

  const guildMembers = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.guildId, guildId));

  return {
    ...guild,
    createdAt: guild.createdAt.toISOString(),
    updatedAt: guild.updatedAt.toISOString(),
    channels: guildChannels.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    roles: guildRoles.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    members: guildMembers.map((m) => ({
      ...m,
      joinedAt: m.joinedAt.toISOString(),
      premiumSince: m.premiumSince?.toISOString() ?? null,
      communicationDisabledUntil: m.communicationDisabledUntil?.toISOString() ?? null,
    })),
    memberCount: guildMembers.length,
    voiceStates: [],
  };
}

export async function updateGuild(
  guildId: string,
  userId: string,
  data: {
    name?: string;
    icon?: string;
    banner?: string;
    description?: string;
    verificationLevel?: number;
    defaultMessageNotifications?: number;
    explicitContentFilter?: number;
    systemChannelId?: string;
    rulesChannelId?: string;
  }
) {
  const [guild] = await db
    .select({ ownerId: schema.guilds.ownerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (!guild) throw new ApiError(404, "Guild not found");
  // Permission check: owner or MANAGE_GUILD (simplified for now)
  if (guild.ownerId !== userId) {
    throw new ApiError(403, "Missing permissions");
  }

  const [updated] = await db
    .update(schema.guilds)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schema.guilds.id, guildId))
    .returning();

  return {
    ...updated!,
    createdAt: updated!.createdAt.toISOString(),
    updatedAt: updated!.updatedAt.toISOString(),
  };
}

export async function deleteGuild(guildId: string, userId: string) {
  const [guild] = await db
    .select({ ownerId: schema.guilds.ownerId })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (!guild) throw new ApiError(404, "Guild not found");
  if (guild.ownerId !== userId) {
    throw new ApiError(403, "Only the owner can delete a guild");
  }

  await db.delete(schema.guilds).where(eq(schema.guilds.id, guildId));
}

export async function getUserGuilds(userId: string) {
  const userMembers = await db
    .select({ guildId: schema.members.guildId })
    .from(schema.members)
    .where(eq(schema.members.userId, userId));

  if (userMembers.length === 0) return [];

  const guildIds = userMembers.map((m) => m.guildId);

  // Batch fetch all guilds
  const guilds = await db
    .select()
    .from(schema.guilds)
    .where(inArray(schema.guilds.id, guildIds));

  // Batch fetch all channels for these guilds
  const allChannels = await db
    .select()
    .from(schema.channels)
    .where(inArray(schema.channels.guildId, guildIds));

  // Batch fetch all roles for these guilds
  const allRoles = await db
    .select()
    .from(schema.roles)
    .where(inArray(schema.roles.guildId, guildIds));

  // Batch fetch all members for these guilds
  const allMembers = await db
    .select()
    .from(schema.members)
    .where(inArray(schema.members.guildId, guildIds));

  // Index by guildId
  const channelsByGuild = new Map<string, typeof allChannels>();
  for (const c of allChannels) {
    const arr = channelsByGuild.get(c.guildId!) ?? [];
    arr.push(c);
    channelsByGuild.set(c.guildId!, arr);
  }

  const rolesByGuild = new Map<string, typeof allRoles>();
  for (const r of allRoles) {
    const arr = rolesByGuild.get(r.guildId) ?? [];
    arr.push(r);
    rolesByGuild.set(r.guildId, arr);
  }

  const membersByGuild = new Map<string, typeof allMembers>();
  for (const m of allMembers) {
    const arr = membersByGuild.get(m.guildId) ?? [];
    arr.push(m);
    membersByGuild.set(m.guildId, arr);
  }

  return guilds.map((guild) => {
    const guildChannels = channelsByGuild.get(guild.id) ?? [];
    const guildRoles = rolesByGuild.get(guild.id) ?? [];
    const guildMembers = membersByGuild.get(guild.id) ?? [];

    return {
      ...guild,
      createdAt: guild.createdAt.toISOString(),
      updatedAt: guild.updatedAt.toISOString(),
      channels: guildChannels.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
      roles: guildRoles.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      members: guildMembers.map((m) => ({
        ...m,
        joinedAt: m.joinedAt.toISOString(),
        premiumSince: m.premiumSince?.toISOString() ?? null,
        communicationDisabledUntil: m.communicationDisabledUntil?.toISOString() ?? null,
      })),
      memberCount: guildMembers.length,
      voiceStates: [],
    };
  });
}

export async function isMember(userId: string, guildId: string): Promise<boolean> {
  const [member] = await db
    .select({ userId: schema.members.userId })
    .from(schema.members)
    .where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)))
    .limit(1);
  return !!member;
}
