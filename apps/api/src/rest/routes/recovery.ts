import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { db } from "../../db/index.js";
import { users, recoveryKeys } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import crypto from "crypto";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError, hashPassword, verifyPassword, generateToken } from "../../services/auth.service.js";

const useRecoverySchema = z.object({
  email: z.string().email(),
  recoveryKey: z.string().min(1),
});

export async function recoveryRoutes(app: FastifyInstance) {
  // Generate recovery key
  app.post(
    "/auth/recovery/generate",
    { preHandler: [authMiddleware, createRateLimiter("auth")] },
    async (request, reply) => {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1);

      if (!user) throw new ApiError(404, "User not found");

      const recoveryKey = crypto.randomBytes(32).toString("hex");
      const hashedKey = await hashPassword(recoveryKey);

      // Delete existing recovery key if any
      await db
        .delete(recoveryKeys)
        .where(eq(recoveryKeys.userId, request.userId));

      // Insert new recovery key
      await db.insert(recoveryKeys).values({
        id: generateSnowflake(),
        userId: request.userId,
        keyHash: hashedKey,
      });

      return reply.send({
        recoveryKey,
        message: "Store this recovery key safely. It will not be shown again.",
      });
    }
  );

  // Use recovery key
  app.post(
    "/auth/recovery/use",
    { preHandler: [createRateLimiter("auth")] },
    async (request, reply) => {
      const body = useRecoverySchema.parse(request.body);

      const [user] = await db
        .select({ id: users.id, mfaEnabled: users.mfaEnabled })
        .from(users)
        .where(eq(users.email, body.email.toLowerCase()))
        .limit(1);

      if (!user) {
        throw new ApiError(401, "Invalid email or recovery key");
      }

      // Get recovery key from database
      const [storedKey] = await db
        .select({ keyHash: recoveryKeys.keyHash })
        .from(recoveryKeys)
        .where(eq(recoveryKeys.userId, user.id))
        .limit(1);

      if (!storedKey) {
        throw new ApiError(401, "Invalid email or recovery key");
      }

      const valid = await verifyPassword(body.recoveryKey, storedKey.keyHash);
      if (!valid) {
        throw new ApiError(401, "Invalid email or recovery key");
      }

      // Mark recovery key as used and delete it
      await db
        .delete(recoveryKeys)
        .where(eq(recoveryKeys.userId, user.id));

      // Reset MFA if enabled
      if (user.mfaEnabled) {
        await db
          .update(users)
          .set({
            mfaEnabled: false,
            mfaSecret: null,
            mfaBackupCodes: null,
          })
          .where(eq(users.id, user.id));
      }

      const token = generateToken(user.id);

      return reply.send({ token });
    }
  );

  // Check if recovery key exists
  app.get(
    "/auth/recovery/status",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const [existing] = await db
        .select({ id: recoveryKeys.id })
        .from(recoveryKeys)
        .where(eq(recoveryKeys.userId, request.userId))
        .limit(1);

      return reply.send({ hasRecoveryKey: !!existing });
    }
  );
}
