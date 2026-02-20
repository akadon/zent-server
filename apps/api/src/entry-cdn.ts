import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./config/env.js";
import { cdnRoutes } from "./rest/routes/cdn.js";
import { ApiError } from "./services/auth.service.js";
import { globalRateLimit } from "./middleware/rateLimit.js";

const PORT = parseInt(process.env.CDN_PORT || "4003");

const app = Fastify({
  logger: { level: "info" },
});

await app.register(cors, { origin: true, credentials: true, maxAge: 86400 });
await app.register(multipart, {
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
});

app.addHook("preHandler", globalRateLimit);

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send({ statusCode: error.statusCode, message: error.message });
  }
  app.log.error(error);
  return reply.status(500).send({ statusCode: 500, message: "Internal server error" });
});

await app.register(cdnRoutes);

app.get("/health", async () => ({ status: "ok", service: "cdn", pod: process.env.HOSTNAME }));

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`CDN service listening on port ${PORT}`);
