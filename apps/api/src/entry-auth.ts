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

const PORT = parseInt(process.env.AUTH_PORT || "4001");

const app = Fastify({
  logger: { level: "info" },
});

await app.register(cors, { origin: true, credentials: true });
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

app.get("/health", async () => ({ status: "ok", service: "auth", pod: process.env.HOSTNAME }));

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`Auth service listening on port ${PORT}`);
