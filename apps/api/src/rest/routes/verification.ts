import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { db, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import crypto from "crypto";
import { ApiError } from "../../services/auth.service.js";
import { redis } from "../../config/redis.js";

const VERIFICATION_CODE_TTL = 10 * 60; // 10 minutes

const confirmSchema = z.object({
  code: z.string().length(6).regex(/^\d+$/),
});

export async function verificationRoutes(app: FastifyInstance) {
  // Send verification code
  app.post(
    "/auth/verify/send",
    { preHandler: [authMiddleware, createRateLimiter("auth")] },
    async (request, reply) => {
      const [user] = await db
        .select({ id: schema.users.id, verified: schema.users.verified, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, request.userId))
        .limit(1);

      if (!user) throw new ApiError(404, "User not found");
      if (user.verified) throw new ApiError(400, "Email is already verified");

      const code = crypto.randomInt(100000, 999999).toString();

      // Store in Redis with TTL
      await redis.setex(`verification:${request.userId}`, VERIFICATION_CODE_TTL, code);

      // In production, this would send an email to user.email
      // For development, log the code
      if (process.env.NODE_ENV !== "production") {
        console.log(`Verification code for ${user.email}: ${code}`);
      }

      return reply.send({ success: true, message: "Verification code sent" });
    }
  );

  // Confirm verification code
  app.post(
    "/auth/verify/confirm",
    { preHandler: [authMiddleware, createRateLimiter("auth")] },
    async (request, reply) => {
      const body = confirmSchema.parse(request.body);

      const storedCode = await redis.get(`verification:${request.userId}`);

      if (!storedCode) {
        throw new ApiError(400, "No verification code found. Please request a new one.");
      }

      if (storedCode !== body.code) {
        throw new ApiError(400, "Invalid verification code");
      }

      // Delete the code
      await redis.del(`verification:${request.userId}`);

      // Mark user as verified
      await db
        .update(schema.users)
        .set({ verified: true })
        .where(eq(schema.users.id, request.userId));

      return reply.send({ verified: true });
    }
  );

  // Get verification status
  app.get(
    "/auth/verify/status",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const [user] = await db
        .select({ verified: schema.users.verified })
        .from(schema.users)
        .where(eq(schema.users.id, request.userId))
        .limit(1);

      if (!user) throw new ApiError(404, "User not found");

      return reply.send({ verified: user.verified });
    }
  );
}
