import type { FastifyRequest, FastifyReply } from "fastify";
import { redis } from "../config/redis.js";
import { ApiError } from "../services/auth.service.js";

interface RateLimitConfig {
  /** Max requests allowed in the window */
  max: number;
  /** Window size in seconds */
  window: number;
  /** Key prefix for Redis */
  keyPrefix: string;
}

const DEFAULTS: Record<string, RateLimitConfig> = {
  global: { max: 50, window: 1, keyPrefix: "rl:global" },
  auth: { max: 5, window: 60, keyPrefix: "rl:auth" },
  messageCreate: { max: 5, window: 5, keyPrefix: "rl:msg" },
  messageDelete: { max: 5, window: 1, keyPrefix: "rl:msgdel" },
  channelEdit: { max: 10, window: 10, keyPrefix: "rl:ch" },
  guildCreate: { max: 10, window: 3600, keyPrefix: "rl:guild" },
  inviteCreate: { max: 5, window: 60, keyPrefix: "rl:invite" },
  typing: { max: 10, window: 10, keyPrefix: "rl:typing" },
  reaction: { max: 10, window: 5, keyPrefix: "rl:react" },
};

/**
 * Sliding window rate limiter using Redis.
 * Uses sorted sets with timestamps for accurate sliding windows.
 */
async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetAfter: number }> {
  const key = `${config.keyPrefix}:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.window * 1000;

  const pipeline = redis.pipeline();
  // Remove entries outside the window
  pipeline.zremrangebyscore(key, 0, windowStart);
  // Count current entries
  pipeline.zcard(key);
  // Add current request
  pipeline.zadd(key, now, `${now}:${Math.random()}`);
  // Set expiry on the key
  pipeline.expire(key, config.window + 1);

  const results = await pipeline.exec();
  const count = (results?.[1]?.[1] as number) ?? 0;

  if (count >= config.max) {
    // Find the oldest entry to calculate reset time
    const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
    const oldestTime = oldest.length >= 2 ? parseInt(oldest[1]!, 10) : now;
    const resetAfter = Math.max(0, config.window * 1000 - (now - oldestTime));

    return { allowed: false, remaining: 0, resetAfter };
  }

  return {
    allowed: true,
    remaining: config.max - count - 1,
    resetAfter: config.window * 1000,
  };
}

function setRateLimitHeaders(reply: FastifyReply, config: RateLimitConfig, remaining: number, resetAfter: number) {
  reply.header("X-RateLimit-Limit", config.max);
  reply.header("X-RateLimit-Remaining", Math.max(0, remaining));
  reply.header("X-RateLimit-Reset-After", Math.ceil(resetAfter / 1000));
}

export function createRateLimiter(bucket: keyof typeof DEFAULTS) {
  const config = DEFAULTS[bucket]!;

  return async function rateLimitMiddleware(request: FastifyRequest, reply: FastifyReply) {
    // Use userId if authed, otherwise IP
    const identifier = (request as any).userId ?? request.ip;
    const result = await checkRateLimit(identifier, config);

    setRateLimitHeaders(reply, config, result.remaining, result.resetAfter);

    if (!result.allowed) {
      reply.header("Retry-After", Math.ceil(result.resetAfter / 1000));
      throw new ApiError(429, "You are being rate limited");
    }
  };
}

/**
 * Global rate limiter applied to all routes.
 */
export async function globalRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const config = DEFAULTS.global!;
  const identifier = (request as any).userId ?? request.ip;
  const result = await checkRateLimit(identifier, config);

  setRateLimitHeaders(reply, config, result.remaining, result.resetAfter);

  if (!result.allowed) {
    reply.header("Retry-After", Math.ceil(result.resetAfter / 1000));
    throw new ApiError(429, "You are being rate limited");
  }
}
