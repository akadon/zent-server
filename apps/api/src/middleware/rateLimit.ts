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

// Lua script for atomic sliding window rate limiting
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
local count = redis.call('ZCARD', key)

if count < max_requests then
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, ttl)
  return {1, max_requests - count - 1, 0}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldest_time = 0
  if #oldest >= 2 then
    oldest_time = tonumber(oldest[2])
  end
  return {0, 0, oldest_time}
end
`;

/**
 * Sliding window rate limiter using Redis.
 * Uses a Lua script for atomic check-and-increment to prevent race conditions.
 */
async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetAfter: number }> {
  const key = `${config.keyPrefix}:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.window * 1000;
  const member = `${now}:${Math.random()}`;

  const result = await redis.eval(
    RATE_LIMIT_SCRIPT,
    1,
    key,
    now.toString(),
    windowStart.toString(),
    config.max.toString(),
    (config.window + 1).toString(),
    member
  ) as [number, number, number];

  const [allowed, remaining, oldestTime] = result;

  if (!allowed) {
    const resetAfter = oldestTime > 0
      ? Math.max(0, config.window * 1000 - (now - oldestTime))
      : config.window * 1000;
    return { allowed: false, remaining: 0, resetAfter };
  }

  return {
    allowed: true,
    remaining,
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
