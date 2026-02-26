import { generateSnowflake } from "@yxc/snowflake";
import { DEFAULT_PERMISSIONS } from "@yxc/permissions";
import { ApiError } from "./auth.service.js";
import { ChannelType } from "@yxc/types";
import { invalidateGuildPermissions } from "./permission.service.js";
import { env } from "../config/env.js";
import { guildRepository } from "../repositories/guild.repository.js";
import { channelRepository } from "../repositories/channel.repository.js";
import { memberRepository } from "../repositories/member.repository.js";
import { roleRepository } from "../repositories/role.repository.js";

async function fetchVoiceStates(guildId: string): Promise<any[]> {
  if (!env.VOICE_SERVICE_URL) return [];
  try {
    const headers: Record<string, string> = {};
    if (env.VOICE_INTERNAL_KEY) headers["x-internal-key"] = env.VOICE_INTERNAL_KEY;
    const res = await fetch(`${env.VOICE_SERVICE_URL}/api/voice/${guildId}/states`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    return (await res.json()) as any[];
  } catch {
    return [];
  }
}

export async function createGuild(ownerId: string, name: string, icon?: string) {
  const guildId = generateSnowflake();
  const everyoneRoleId = guildId; // @everyone role ID = guild ID (Discord convention)
  const generalChannelId = generateSnowflake();
  const voiceChannelId = generateSnowflake();

  await guildRepository.transaction(async (tx) => {
    // Create guild
    await guildRepository.create(tx, {
      id: guildId,
      name,
      icon: icon ?? null,
      ownerId,
      systemChannelId: generalChannelId,
    });

    // Create @everyone role
    await roleRepository.createInTx(tx, {
      id: everyoneRoleId,
      guildId,
      name: "@everyone",
      permissions: DEFAULT_PERMISSIONS.toString(),
      position: 0,
    });

    // Create default channels
    await channelRepository.createMany(tx, [
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
    await memberRepository.createInTx(tx, {
      userId: ownerId,
      guildId,
    });
  });

  return getGuild(guildId);
}

export async function getGuild(guildId: string) {
  const guild = await guildRepository.findById(guildId);
  if (!guild) return null;

  const [guildChannels, guildRoles, memberCount, voiceStates] = await Promise.all([
    channelRepository.findByGuildId(guildId),
    roleRepository.findByGuildId(guildId),
    guildRepository.getMemberCount(guildId),
    fetchVoiceStates(guildId),
  ]);

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
    memberCount,
    voiceStates,
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
  const guild = await guildRepository.findOwnerById(guildId);
  if (!guild) throw new ApiError(404, "Guild not found");

  const updated = await guildRepository.update(guildId, data);

  return {
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function deleteGuild(guildId: string, userId: string) {
  const guild = await guildRepository.findOwnerById(guildId);
  if (!guild) throw new ApiError(404, "Guild not found");
  if (guild.ownerId !== userId) {
    throw new ApiError(403, "Only the owner can delete a guild");
  }

  await guildRepository.delete(guildId);
}

export async function getUserGuilds(userId: string) {
  const userMembers = await memberRepository.findGuildIdsByUserId(userId);
  if (userMembers.length === 0) return [];

  const guildIds = userMembers.map((m) => m.guildId);

  // Batch fetch all data for these guilds
  const [guilds, allChannels, allRoles, allMembers] = await Promise.all([
    guildRepository.findByIds(guildIds),
    channelRepository.findByGuildIds(guildIds),
    roleRepository.findByGuildIds(guildIds),
    memberRepository.findByGuildIds(guildIds),
  ]);

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

  // Fetch voice states with concurrency limit (max 5 at a time)
  const voiceByGuild = new Map<string, any[]>();
  const BATCH_SIZE = 5;
  for (let i = 0; i < guilds.length; i += BATCH_SIZE) {
    const batch = guilds.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((g) => fetchVoiceStates(g.id)));
    batch.forEach((guild, j) => {
      const result = results[j]!;
      voiceByGuild.set(guild.id, result.status === "fulfilled" ? result.value : []);
    });
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
      voiceStates: voiceByGuild.get(guild.id) ?? [],
    };
  });
}

export async function transferOwnership(guildId: string, currentOwnerId: string, newOwnerId: string) {
  const guild = await guildRepository.findOwnerById(guildId);
  if (!guild) throw new ApiError(404, "Guild not found");
  if (guild.ownerId !== currentOwnerId) throw new ApiError(403, "Only the owner can transfer ownership");

  const updated = await guildRepository.update(guildId, { ownerId: newOwnerId });

  await invalidateGuildPermissions(guildId);

  return {
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function isMember(userId: string, guildId: string): Promise<boolean> {
  return memberRepository.exists(userId, guildId);
}
