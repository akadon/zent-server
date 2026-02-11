import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { db, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import { ApiError, generateToken } from "../../services/auth.service.js";
import * as passkeyService from "../../services/passkey.service.js";

const registerCompleteSchema = z.object({
  credentialId: z.string().min(1),
  publicKey: z.string().min(1),
  deviceType: z.string().optional(),
  transports: z.array(z.string()).optional(),
  aaguid: z.string().optional(),
});

const authenticateCompleteSchema = z.object({
  credentialId: z.string().min(1),
  authenticatorData: z.string().min(1),
  signature: z.string().min(1),
  challenge: z.string().min(1),
});

export async function passkeyRoutes(app: FastifyInstance) {
  // Begin passkey registration
  app.post(
    "/auth/passkeys/register/begin",
    { preHandler: [authMiddleware, createRateLimiter("auth")] },
    async (request, reply) => {
      const [user] = await db
        .select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName })
        .from(schema.users)
        .where(eq(schema.users.id, request.userId))
        .limit(1);

      if (!user) throw new ApiError(404, "User not found");

      const challenge = await passkeyService.createChallenge(request.userId);
      const existingCredentials = await passkeyService.getUserCredentials(request.userId);

      return reply.send({
        challenge,
        rp: { name: "Zent", id: "localhost" },
        user: {
          id: Buffer.from(user.id).toString("base64url"),
          name: user.username,
          displayName: user.displayName ?? user.username,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },   // ES256
          { alg: -257, type: "public-key" },  // RS256
        ],
        timeout: 300000,
        attestation: "none",
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "preferred",
        },
        excludeCredentials: existingCredentials.map((c) => ({
          id: c.credentialId,
          type: "public-key",
        })),
      });
    }
  );

  // Complete passkey registration
  app.post(
    "/auth/passkeys/register/complete",
    { preHandler: [authMiddleware, createRateLimiter("auth")] },
    async (request, reply) => {
      const body = registerCompleteSchema.parse(request.body);

      const credential = await passkeyService.createCredential(request.userId, {
        credentialId: body.credentialId,
        publicKey: body.publicKey,
        deviceType: body.deviceType,
        transports: body.transports,
        aaguid: body.aaguid,
      });

      return reply.send({
        success: true,
        credential: {
          id: credential.credentialId,
          deviceType: credential.deviceType,
          createdAt: credential.createdAt.toISOString(),
        },
      });
    }
  );

  // Begin passkey authentication
  app.post(
    "/auth/passkeys/authenticate/begin",
    { preHandler: [createRateLimiter("auth")] },
    async (_request, reply) => {
      const challenge = await passkeyService.createChallenge();

      return reply.send({
        challenge,
        allowCredentials: [],
        timeout: 300000,
        userVerification: "preferred",
      });
    }
  );

  // Complete passkey authentication
  app.post(
    "/auth/passkeys/authenticate/complete",
    { preHandler: [createRateLimiter("auth")] },
    async (request, reply) => {
      const body = authenticateCompleteSchema.parse(request.body);

      const userId = await passkeyService.authenticateWithCredential(
        body.credentialId,
        body.challenge
      );

      const token = generateToken(userId);
      return reply.send({ token });
    }
  );

  // List passkeys
  app.get(
    "/auth/passkeys",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const credentials = await passkeyService.getUserCredentials(request.userId);

      return reply.send({
        passkeys: credentials.map((c) => ({
          id: c.credentialId,
          deviceType: c.deviceType,
          backedUp: c.backedUp,
          createdAt: c.createdAt.toISOString(),
        })),
      });
    }
  );

  // Delete passkey
  app.delete(
    "/auth/passkeys/:credentialId",
    { preHandler: [authMiddleware, createRateLimiter("auth")] },
    async (request, reply) => {
      const { credentialId } = request.params as { credentialId: string };

      await passkeyService.deleteCredential(request.userId, credentialId);

      return reply.send({ success: true });
    }
  );
}
