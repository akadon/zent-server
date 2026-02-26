import { redisPub } from "../config/redis.js";

/**
 * Dispatch event to all members of a guild (pub/sub + event log for polling).
 */
export async function dispatchGuild(guildId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  const now = Date.now();
  await Promise.all([
    redisPub.publish(`gateway:guild:${guildId}`, payload),
    redisPub.zadd(`guild_events:${guildId}`, now, `${now}:${payload}`),
    redisPub.zremrangebyscore(`guild_events:${guildId}`, "-inf", now - 60000),
  ]);
}

/**
 * Dispatch event to a specific user (pub/sub + event log for polling).
 */
export async function dispatchUser(userId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  const now = Date.now();
  await Promise.all([
    redisPub.publish(`gateway:user:${userId}`, payload),
    redisPub.zadd(`user_events:${userId}`, now, `${now}:${payload}`),
    redisPub.zremrangebyscore(`user_events:${userId}`, "-inf", now - 60000),
  ]);
}
