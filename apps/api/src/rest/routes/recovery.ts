import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import crypto from "crypto";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError, hashPassword, verifyPassword, generateToken } from "../../services/auth.service.js";
import { userRepository } from "../../repositories/user.repository.js";
import { recoveryKeyRepository } from "../../repositories/recovery-key.repository.js";

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
      const user = await userRepository.findById(request.userId);
      if (!user) throw new ApiError(404, "User not found");

      const recoveryKey = crypto.randomBytes(32).toString("hex");
      const hashedKey = await hashPassword(recoveryKey);

      // Delete existing recovery key if any
      await recoveryKeyRepository.deleteByUserId(request.userId);

      // Insert new recovery key
      await recoveryKeyRepository.create({
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

      const user = await userRepository.findByEmail(body.email.toLowerCase());
      if (!user) {
        throw new ApiError(401, "Invalid email or recovery key");
      }

      // Get recovery key from database
      const storedKey = await recoveryKeyRepository.findByUserId(user.id);
      if (!storedKey) {
        throw new ApiError(401, "Invalid email or recovery key");
      }

      const valid = await verifyPassword(body.recoveryKey, storedKey.keyHash);
      if (!valid) {
        throw new ApiError(401, "Invalid email or recovery key");
      }

      // Mark recovery key as used and delete it
      await recoveryKeyRepository.deleteByUserId(user.id);

      // Reset MFA if enabled
      if (user.mfaEnabled) {
        await userRepository.update(user.id, {
          mfaEnabled: false,
          mfaSecret: null,
          mfaBackupCodes: null,
        });
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
      const existing = await recoveryKeyRepository.findByUserId(request.userId);
      return reply.send({ hasRecoveryKey: !!existing });
    }
  );
}
