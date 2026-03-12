import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { env } from "./config/env.js";
import { authRoutes } from "./rest/routes/auth.js";
import { mfaRoutes } from "./rest/routes/mfa.js";
import { passkeyRoutes } from "./rest/routes/passkeys.js";
import { recoveryRoutes } from "./rest/routes/recovery.js";
import { sessionRoutes } from "./rest/routes/sessions.js";
import { verificationRoutes } from "./rest/routes/verification.js";
import { ApiError } from "./services/auth.service.js";
import { ZodError } from "zod";
import { globalRateLimit } from "./middleware/rateLimit.js";
import { redis } from "./config/redis.js";
import { db } from "./db/index.js";
import { sql } from "drizzle-orm";

const PORT = parseInt(process.env.AUTH_PORT || "4001");

const app = Fastify({
  trustProxy: true,
  logger: { level: "info" },
});

await app.register(cors, {
  origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(",") : ["http://localhost:3000"],
  credentials: true,
  maxAge: 86400,
});
await app.register(cookie);

app.addHook("preHandler", globalRateLimit);

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send({ statusCode: error.statusCode, message: error.message });
  }
  if (error instanceof ZodError) {
    return reply.status(400).send({ statusCode: 400, message: "Validation error", errors: error.errors });
  }
  app.log.error(error);
  return reply.status(500).send({ statusCode: 500, message: "Internal server error" });
});

await app.register(authRoutes, { prefix: "/api" });
await app.register(mfaRoutes, { prefix: "/api" });
await app.register(passkeyRoutes, { prefix: "/api" });
await app.register(recoveryRoutes, { prefix: "/api" });
await app.register(sessionRoutes, { prefix: "/api" });
await app.register(verificationRoutes, { prefix: "/api" });

let draining = false;

app.get("/health", async (_request, reply) => {
  if (draining) {
    reply.status(503);
    return { status: "draining", service: "auth", pod: process.env.HOSTNAME };
  }

  const checks: Record<string, string> = { auth: "ok" };
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

  const allOk = checks.database === "ok" && checks.redis === "ok";
  if (!allOk) reply.status(503);
  return { status: allOk ? "ok" : "degraded", service: "auth", checks, pod: process.env.HOSTNAME };
});

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`Auth service listening on port ${PORT}`);

async function gracefulShutdown(signal: string) {
  console.log(`Auth: ${signal} received — draining`);
  draining = true;
  await new Promise((r) => setTimeout(r, 5000));
  try {
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 10_000))]);
  } catch {}
  console.log("Auth: shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
