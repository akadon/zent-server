import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { createServer } from "http";
import { env } from "./config/env.js";
import { config } from "./config/config.js";
import { initSnowflake } from "@yxc/snowflake";
import { db } from "./db/index.js";
import { redis } from "./config/redis.js";
import { sql } from "drizzle-orm";
import { authRoutes } from "./rest/routes/auth.js";
import { guildRoutes } from "./rest/routes/guilds.js";
import { messageRoutes } from "./rest/routes/messages.js";
import { userRoutes } from "./rest/routes/users.js";
import { publicWebhookRoutes } from "./rest/routes/webhookExec.js";
import { cdnRoutes } from "./rest/routes/cdn.js";
import { pollRoutes } from "./rest/routes/polls.js";
import { featureRoutes } from "./rest/routes/features.js";
import { moderationRoutes } from "./rest/routes/moderation.js";
import searchRoutes from "./rest/routes/search.js";
import { mfaRoutes } from "./rest/routes/mfa.js";
import { automodRoutes } from "./rest/routes/automod.js";
import { verificationRoutes } from "./rest/routes/verification.js";
import { passkeyRoutes } from "./rest/routes/passkeys.js";
import { recoveryRoutes } from "./rest/routes/recovery.js";
import { eventRoutes } from "./rest/routes/events.js";
import { publicRoutes } from "./rest/routes/public.js";
import { applicationRoutes } from "./rest/routes/applications.js";
import { stickerRoutes } from "./rest/routes/stickers.js";
import { interactionRoutes } from "./rest/routes/interactions.js";
import { forumTagRoutes } from "./rest/routes/forumTags.js";
import { sessionRoutes } from "./rest/routes/sessions.js";
import { createGateway } from "./gateway/index.js";
import { startBackgroundJobs } from "./jobs/index.js";
import { ApiError } from "./services/auth.service.js";
import { ZodError } from "zod";
import { globalRateLimit } from "./middleware/rateLimit.js";

// Dynamic worker ID from pod hostname for unique snowflake IDs across replicas
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}
const podName = process.env.HOSTNAME || "default";
const workerId = hashCode(podName) % 32;
const processId = hashCode(podName + "-proc") % 32;
initSnowflake(workerId, processId);
console.log(`Snowflake initialized: workerId=${workerId}, processId=${processId} (pod: ${podName})`);

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "warn" : "debug",
    transport:
      env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// CORS
await app.register(cors, {
  origin: config.cors.origins,
  credentials: true,
  maxAge: 86400,
});

// Cookies
await app.register(cookie);

// Multipart (file uploads)
await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 10,
  },
});

// Allow empty body with application/json content-type (e.g. POST /typing)
app.removeContentTypeParser("application/json");
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => {
    if (!body || (body as string).length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// Global rate limiting
app.addHook("preHandler", globalRateLimit);

// Adaptive poll interval — tells clients how often to poll based on load
let requestCount = 0;
let pollIntervalMs = 3000;
setInterval(() => {
  // Adjust every 10s based on request rate
  if (requestCount > 500) pollIntervalMs = Math.min(15000, pollIntervalMs + 1000);
  else if (requestCount > 200) pollIntervalMs = Math.min(10000, pollIntervalMs + 500);
  else if (requestCount < 50) pollIntervalMs = Math.max(3000, pollIntervalMs - 1000);
  else pollIntervalMs = Math.max(3000, pollIntervalMs - 500);
  requestCount = 0;
}, 10000);

app.addHook("onSend", async (_request, reply) => {
  requestCount++;
  reply.header("X-Poll-Interval", pollIntervalMs);
});

// Error handler
app.setErrorHandler((error: any, request, reply) => {
  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      message: error.message,
    });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      statusCode: 400,
      message: "Validation error",
      errors: error.errors,
    });
  }

  if (error.statusCode && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      message: error.message,
    });
  }

  app.log.error(error);
  return reply.status(500).send({
    statusCode: 500,
    message: "Internal server error",
  });
});

// Register routes
await app.register(authRoutes, { prefix: "/api" });
await app.register(guildRoutes, { prefix: "/api" });
await app.register(messageRoutes, { prefix: "/api" });
await app.register(userRoutes, { prefix: "/api" });
await app.register(publicWebhookRoutes, { prefix: "/api" });
await app.register(pollRoutes, { prefix: "/api" });
await app.register(featureRoutes, { prefix: "/api" });
await app.register(moderationRoutes, { prefix: "/api" });
await app.register(searchRoutes, { prefix: "/api" });
await app.register(mfaRoutes, { prefix: "/api" });
await app.register(automodRoutes, { prefix: "/api" });
await app.register(verificationRoutes, { prefix: "/api" });
await app.register(passkeyRoutes, { prefix: "/api" });
await app.register(recoveryRoutes, { prefix: "/api" });
await app.register(eventRoutes, { prefix: "/api" });
await app.register(publicRoutes, { prefix: "/api" });
await app.register(applicationRoutes, { prefix: "/api" });
await app.register(stickerRoutes, { prefix: "/api" });
await app.register(interactionRoutes, { prefix: "/api" });
await app.register(forumTagRoutes, { prefix: "/api" });
await app.register(sessionRoutes, { prefix: "/api" });
await app.register(cdnRoutes); // CDN routes at root (no /api prefix)

// Health check with dependency verification
app.get("/health", async () => {
  const checks: Record<string, string> = { api: "ok" };
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }
  try {
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }
  const allOk = Object.values(checks).every(v => v === "ok");
  return { status: allOk ? "ok" : "degraded", checks, pod: process.env.HOSTNAME };
});

// Start server
const start = async () => {
  try {
    const server = app.server;

    // Attach Socket.IO gateway to the same HTTP server
    const io = createGateway(server);
    app.decorate("io", io);

    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info(`API server listening on ${env.API_HOST}:${env.API_PORT}`);
    app.log.info(`Gateway WebSocket available at /gateway`);

    // Start background jobs (scheduled messages, cleanup)
    startBackgroundJobs();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
