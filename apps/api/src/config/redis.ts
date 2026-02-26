import Redis from "ioredis";
import { env } from "./env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableAutoPipelining: true,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
});

// Separate connection for pub/sub (ioredis requires dedicated connections for subscribers)
export const redisSub = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

export const redisPub = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableAutoPipelining: true,
});
