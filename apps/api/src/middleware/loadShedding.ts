import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Load shedding based on event loop lag.
 * When the event loop is heavily delayed, reject low-priority requests (503)
 * to preserve capacity for critical operations.
 */

const LAG_CHECK_INTERVAL = 500; // ms
const LAG_THRESHOLD_WARN = 100; // ms — start shedding non-critical
const LAG_THRESHOLD_CRITICAL = 500; // ms — shed everything except health

let eventLoopLag = 0;
let lastCheck = Date.now();

// Measure event loop lag by comparing expected vs actual setTimeout timing
function measureLag() {
  const expected = LAG_CHECK_INTERVAL;
  const now = Date.now();
  const actual = now - lastCheck;
  eventLoopLag = Math.max(0, actual - expected);
  lastCheck = now;
  setTimeout(measureLag, LAG_CHECK_INTERVAL);
}
setTimeout(measureLag, LAG_CHECK_INTERVAL);

// Routes that are always allowed (health checks, already-connected WS)
const CRITICAL_PATHS = new Set(["/health", "/gateway"]);

// High-priority routes that survive warn-level shedding
const HIGH_PRIORITY_PREFIXES = ["/api/auth", "/api/users/@me"];

function isHighPriority(url: string): boolean {
  return HIGH_PRIORITY_PREFIXES.some((p) => url.startsWith(p));
}

export function getEventLoopLag(): number {
  return eventLoopLag;
}

export async function loadSheddingMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url.split("?")[0]!;

  // Always allow critical paths
  if (CRITICAL_PATHS.has(path)) return;

  if (eventLoopLag >= LAG_THRESHOLD_CRITICAL) {
    reply.header("Retry-After", "5");
    reply.status(503).send({ statusCode: 503, message: "Service overloaded, please retry" });
    return reply;
  }

  if (eventLoopLag >= LAG_THRESHOLD_WARN && !isHighPriority(path)) {
    reply.header("Retry-After", "2");
    reply.status(503).send({ statusCode: 503, message: "Service overloaded, please retry" });
    return reply;
  }
}
