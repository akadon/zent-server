import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { computePermissions, PermissionsBitfield, type PermissionOverwrite, type RolePermission } from "@yxc/permissions";
import { ApiError } from "./auth.service.js";
import { redis, redisPub, redisSub } from "../config/redis.js";

// ── Two-Tier Permission Cache ──

const PERM_LRU_MAX = 5000;
const PERM_LRU_TTL = 60_000; // 60s
const PERM_REDIS_TTL = 300; // 5min

// Singleflight: prevent thundering herd on cache miss
const inFlightRequests = new Map<string, Promise<PermissionsBitfield>>();

async function redisScan(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

interface CacheEntry {
  value: string; // serialized bigint
  expiresAt: number;
}

const permLRU = new Map<string, CacheEntry>();

function lruGet(key: string): bigint | null {
  const entry = permLRU.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    permLRU.delete(key);
    return null;
  }
  // Move to end (most recently used)
  permLRU.delete(key);
  permLRU.set(key, entry);
  return BigInt(entry.value);
}

function lruSet(key: string, value: bigint) {
  if (permLRU.size >= PERM_LRU_MAX) {
    // Evict oldest (first entry)
    const firstKey = permLRU.keys().next().value;
    if (firstKey) permLRU.delete(firstKey);
  }
  permLRU.set(key, { value: value.toString(), expiresAt: Date.now() + PERM_LRU_TTL });
}

function lruDelete(pattern: string) {
  for (const key of permLRU.keys()) {
    if (key.startsWith(pattern)) {
      permLRU.delete(key);
    }
  }
}

async function cachedPermissions(key: string, compute: () => Promise<PermissionsBitfield>): Promise<PermissionsBitfield> {
  // L1: LRU
  const lruHit = lruGet(key);
  if (lruHit !== null) {
    return new PermissionsBitfield(lruHit);
  }

  // L2: Redis
  const redisKey = `perm:${key}`;
  const cached = await redis.get(redisKey);
  if (cached !== null) {
    const value = BigInt(cached);
    lruSet(key, value);
    return new PermissionsBitfield(value);
  }

  // Singleflight: deduplicate concurrent cache misses for the same key
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const result = await compute();
    const bits = result.toBigInt();
    lruSet(key, bits);
    await redis.set(redisKey, bits.toString(), "EX", PERM_REDIS_TTL);
    return result;
  })();

  inFlightRequests.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlightRequests.delete(key);
  }
}

/**
 * Invalidate permission cache for a user in a guild (and all channels).
 */
export async function invalidatePermissions(userId: string, guildId: string) {
  const prefix = `${userId}:${guildId}`;
  lruDelete(prefix);

  // Delete Redis keys matching this pattern (SCAN instead of KEYS to avoid blocking)
  const pattern = `perm:${prefix}*`;
  const keys = await redisScan(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  // Publish invalidation to other instances
  await redisPub.publish("perm:invalidate", JSON.stringify({ userId, guildId }));
}

/**
 * Invalidate permission cache for ALL users in a guild.
 */
export async function invalidateGuildPermissions(guildId: string) {
  // Clear local LRU entries containing this guildId
  for (const key of permLRU.keys()) {
    if (key.includes(`:${guildId}`)) {
      permLRU.delete(key);
    }
  }

  const pattern = `perm:*:${guildId}*`;
  const keys = await redisScan(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  await redisPub.publish("perm:invalidate", JSON.stringify({ guildId }));
}

// Listen for invalidation events from other instances
const permInvalidateSub = redisSub.duplicate();
permInvalidateSub.subscribe("perm:invalidate");
permInvalidateSub.on("message", (_channel, message) => {
  try {
    const { userId, guildId } = JSON.parse(message);
    if (userId && guildId) {
      lruDelete(`${userId}:${guildId}`);
    } else if (guildId) {
      for (const key of permLRU.keys()) {
        if (key.includes(`:${guildId}`)) {
          permLRU.delete(key);
        }
      }
    }
  } catch {
    // ignore
  }
});

// ── Permission Computation ──

/**
 * Get effective permissions for a user in a guild (no channel context).
 */
export async function getGuildPermissions(
  userId: string,
  guildId: string
): Promise<PermissionsBitfield> {
  return cachedPermissions(`${userId}:${guildId}`, async () => {
    const [guild] = await db
      .select({ ownerId: schema.guilds.ownerId })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, guildId))
      .limit(1);

    if (!guild) throw new ApiError(404, "Guild not found");

    const [everyoneRole] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.guildId, guildId), eq(schema.roles.name, "@everyone")))
      .limit(1);

    if (!everyoneRole) throw new ApiError(500, "Missing @everyone role");

    const memberRoleRecords = await db
      .select({ roleId: schema.memberRoles.roleId })
      .from(schema.memberRoles)
      .where(and(eq(schema.memberRoles.userId, userId), eq(schema.memberRoles.guildId, guildId)));

    const roleIds = memberRoleRecords.map((r) => r.roleId);
    let memberRoles: RolePermission[] = [];
    if (roleIds.length > 0) {
      const fetchedRoles = await db
        .select({ id: schema.roles.id, permissions: schema.roles.permissions, position: schema.roles.position })
        .from(schema.roles)
        .where(inArray(schema.roles.id, roleIds));
      memberRoles = fetchedRoles.map((r) => ({ id: r.id, permissions: BigInt(r.permissions), position: r.position }));
    }

    return computePermissions({
      userId,
      guildOwnerId: guild.ownerId,
      everyoneRole: {
        id: everyoneRole.id,
        permissions: BigInt(everyoneRole.permissions),
        position: everyoneRole.position,
      },
      memberRoles,
    });
  });
}

/**
 * Get effective permissions for a user in a specific channel.
 */
export async function getChannelPermissions(
  userId: string,
  guildId: string,
  channelId: string
): Promise<PermissionsBitfield> {
  return cachedPermissions(`${userId}:${guildId}:${channelId}`, async () => {
    const [guild] = await db
      .select({ ownerId: schema.guilds.ownerId })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, guildId))
      .limit(1);

    if (!guild) throw new ApiError(404, "Guild not found");

    const [everyoneRole] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.guildId, guildId), eq(schema.roles.name, "@everyone")))
      .limit(1);

    if (!everyoneRole) throw new ApiError(500, "Missing @everyone role");

    const memberRoleRecords = await db
      .select({ roleId: schema.memberRoles.roleId })
      .from(schema.memberRoles)
      .where(and(eq(schema.memberRoles.userId, userId), eq(schema.memberRoles.guildId, guildId)));

    const roleIds = memberRoleRecords.map((r) => r.roleId);
    let memberRoles: RolePermission[] = [];
    if (roleIds.length > 0) {
      const fetchedRoles = await db
        .select({ id: schema.roles.id, permissions: schema.roles.permissions, position: schema.roles.position })
        .from(schema.roles)
        .where(inArray(schema.roles.id, roleIds));
      memberRoles = fetchedRoles.map((r) => ({ id: r.id, permissions: BigInt(r.permissions), position: r.position }));
    }

    const overwrites = await db
      .select()
      .from(schema.permissionOverwrites)
      .where(eq(schema.permissionOverwrites.channelId, channelId));

    const channelOverwrites: PermissionOverwrite[] = overwrites.map((o) => ({
      id: o.targetId,
      type: o.targetType as 0 | 1,
      allow: BigInt(o.allow),
      deny: BigInt(o.deny),
    }));

    return computePermissions({
      userId,
      guildOwnerId: guild.ownerId,
      everyoneRole: {
        id: everyoneRole.id,
        permissions: BigInt(everyoneRole.permissions),
        position: everyoneRole.position,
      },
      memberRoles,
      channelOverwrites,
    });
  });
}

/**
 * Check that a user has the required guild-level permission, throw 403 if not.
 */
export async function requireGuildPermission(
  userId: string,
  guildId: string,
  permission: bigint
): Promise<void> {
  const perms = await getGuildPermissions(userId, guildId);
  if (!perms.has(permission)) {
    throw new ApiError(403, "Missing permissions");
  }
}

/**
 * Check that a user has the required channel-level permission, throw 403 if not.
 */
export async function requireChannelPermission(
  userId: string,
  guildId: string,
  channelId: string,
  permission: bigint
): Promise<void> {
  const perms = await getChannelPermissions(userId, guildId, channelId);
  if (!perms.has(permission)) {
    throw new ApiError(403, "Missing permissions");
  }
}

// ── Permission Overwrites CRUD ──

export async function setPermissionOverwrite(
  channelId: string,
  targetId: string,
  targetType: 0 | 1,
  allow: string,
  deny: string,
  guildId?: string
) {
  const existing = await db
    .select()
    .from(schema.permissionOverwrites)
    .where(
      and(
        eq(schema.permissionOverwrites.channelId, channelId),
        eq(schema.permissionOverwrites.targetId, targetId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.permissionOverwrites)
      .set({ allow, deny, targetType })
      .where(
        and(
          eq(schema.permissionOverwrites.channelId, channelId),
          eq(schema.permissionOverwrites.targetId, targetId)
        )
      );
  } else {
    await db.insert(schema.permissionOverwrites).values({
      channelId,
      targetId,
      targetType,
      allow,
      deny,
    });
  }

  // Invalidate permissions for affected guild
  if (guildId) {
    await invalidateGuildPermissions(guildId);
  }

  return { channelId, targetId, targetType, allow, deny };
}

export async function deletePermissionOverwrite(channelId: string, targetId: string, guildId?: string) {
  await db
    .delete(schema.permissionOverwrites)
    .where(
      and(
        eq(schema.permissionOverwrites.channelId, channelId),
        eq(schema.permissionOverwrites.targetId, targetId)
      )
    );

  if (guildId) {
    await invalidateGuildPermissions(guildId);
  }
}

export async function getChannelOverwrites(channelId: string) {
  return db
    .select()
    .from(schema.permissionOverwrites)
    .where(eq(schema.permissionOverwrites.channelId, channelId));
}
