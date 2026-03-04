import { redisPub, redis } from "../config/redis.js";

// Events that should be durably queued via Redis Streams for guaranteed delivery
const DURABLE_EVENTS = new Set([
  "MESSAGE_CREATE",
  "MESSAGE_UPDATE",
  "MESSAGE_DELETE",
  "MESSAGE_DELETE_BULK",
]);

const STREAM_KEY = "zent:events:stream";
const STREAM_MAX_LEN = 100_000; // Auto-trim stream to prevent unbounded growth

/**
 * Dispatch event to all members of a guild via Redis pub/sub.
 * Critical message events are also written to Redis Streams for durability.
 */
export async function dispatchGuild(guildId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });

  if (DURABLE_EVENTS.has(event)) {
    // Write to stream for durability, then publish for real-time delivery
    await redis.xadd(
      STREAM_KEY,
      "MAXLEN",
      "~",
      String(STREAM_MAX_LEN),
      "*",
      "type", "guild",
      "target", guildId,
      "event", event,
      "payload", payload
    );
  }

  await redisPub.publish(`gateway:guild:${guildId}`, payload);
}

/**
 * Dispatch event to a specific user via Redis pub/sub.
 */
export async function dispatchUser(userId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  await redisPub.publish(`gateway:user:${userId}`, payload);
}
