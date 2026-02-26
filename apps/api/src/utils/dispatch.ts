import { redisPub } from "../config/redis.js";

/**
 * Dispatch event to all members of a guild via Redis pub/sub.
 */
export async function dispatchGuild(guildId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  await redisPub.publish(`gateway:guild:${guildId}`, payload);
}

/**
 * Dispatch event to a specific user via Redis pub/sub.
 */
export async function dispatchUser(userId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  await redisPub.publish(`gateway:user:${userId}`, payload);
}
