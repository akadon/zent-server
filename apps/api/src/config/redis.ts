import Redis from "ioredis";
import { env } from "./env.js";

/** Exponential backoff with full jitter: base * 2^(times-1) capped, then uniform random [0, cap] */
function jitteredBackoff(times: number): number {
  const base = 50;
  const cap = 3000;
  const exponential = Math.min(base * Math.pow(2, times - 1), cap);
  return Math.floor(Math.random() * exponential);
}

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 10,
  enableAutoPipelining: true,
  lazyConnect: true,
  connectTimeout: 5000,
  retryStrategy: jitteredBackoff,
});

// Separate connection for pub/sub (ioredis requires dedicated connections for subscribers)
export const redisSub = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 10,
  lazyConnect: true,
  connectTimeout: 5000,
  retryStrategy: jitteredBackoff,
});

export const redisPub = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 10,
  enableAutoPipelining: true,
  lazyConnect: true,
  connectTimeout: 5000,
  retryStrategy: jitteredBackoff,
});
