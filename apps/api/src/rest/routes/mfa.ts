import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import crypto from "crypto";
import { ApiError, generateToken, verifyPassword, verifyMfaTicket } from "../../services/auth.service.js";

// Base32 encoding (RFC 4648)
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += BASE32_CHARS[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) throw new ApiError(400, "Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

function generateTOTP(secret: Buffer, timeStep: number = 30, digits: number = 6): string {
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(0, 0);
  counterBuffer.writeUInt32BE(counter, 4);

  const hmac = crypto.createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return (code % 10 ** digits).toString().padStart(digits, "0");
}

function verifyTOTP(secret: Buffer, code: string, window: number = 1): boolean {
  const timeStep = 30;
  const now = Math.floor(Date.now() / 1000 / timeStep);

  for (let i = -window; i <= window; i++) {
    const counter = now + i;
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(0, 0);
    counterBuffer.writeUInt32BE(counter, 4);

    const hmac = crypto.createHmac("sha1", secret).update(counterBuffer).digest();
    const offset = hmac[hmac.length - 1]! & 0x0f;
    const computed =
      ((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff);

    const expected = (computed % 10 ** 6).toString().padStart(6, "0");
    if (expected === code) return true;
  }

  return false;
}

function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    codes.push(crypto.randomBytes(4).toString("hex"));
  }
  return codes;
}

function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

const enableSchema = z.object({
  code: z.string().length(6).regex(/^\d+$/),
  secret: z.string().min(1),
});

const verifySchema = z.object({
  code: z.string().length(6).regex(/^\d+$/),
  ticket: z.string().min(1),
});

const disableSchema = z.object({
  password: z.string().min(1),
});

export async function mfaRoutes(app: FastifyInstance) {
  // Generate TOTP secret for setup
  app.post(
    "/auth/mfa/setup",
    { preHandler: [authMiddleware, createRateLimiter("auth")] },
    async (request, reply) => {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1);

      if (!user) throw new ApiError(404, "User not found");
      if (user.mfaEnabled) throw new ApiError(400, "MFA is already enabled");

      const secretBytes = crypto.randomBytes(20);
      const secret = base32Encode(secretBytes);
      const issuer = "Zent";
      const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

      return reply.send({ secret, uri });
    }
  );

  // Verify TOTP code and enable MFA
  app.post(
    "/auth/mfa/enable",
    { preHandler: [authMiddleware, createRateLimiter("auth")] },
    async (request, reply) => {
      const body = enableSchema.parse(request.body);

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1);

      if (!user) throw new ApiError(404, "User not found");
      if (user.mfaEnabled) throw new ApiError(400, "MFA is already enabled");

      const secretBuffer = base32Decode(body.secret);
      const valid = verifyTOTP(secretBuffer, body.code);

      if (!valid) {
        throw new ApiError(400, "Invalid verification code");
      }

      const backupCodes = generateBackupCodes();
      const hashedBackupCodes = backupCodes.map(hashBackupCode);

      await db
        .update(users)
        .set({
          mfaEnabled: true,
          mfaSecret: body.secret,
          mfaBackupCodes: hashedBackupCodes,
        })
        .where(eq(users.id, request.userId));

      return reply.send({
        enabled: true,
        backupCodes,
      });
    }
  );

  // Verify TOTP during login
  app.post(
    "/auth/mfa/verify",
    { preHandler: [createRateLimiter("auth")] },
    async (request, reply) => {
      const body = verifySchema.parse(request.body);

      // Decode userId from the short-lived MFA ticket instead of trusting client body
      const ticketPayload = verifyMfaTicket(body.ticket);
      const userId = ticketPayload.userId;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) throw new ApiError(404, "User not found");
      if (!user.mfaEnabled || !user.mfaSecret) {
        throw new ApiError(400, "MFA is not enabled for this user");
      }

      const secretBuffer = base32Decode(user.mfaSecret);
      const valid = verifyTOTP(secretBuffer, body.code);

      if (!valid) {
        // Check backup codes
        const codeHash = hashBackupCode(body.code);
        const backupCodes = (user.mfaBackupCodes as string[]) ?? [];
        const backupIndex = backupCodes.indexOf(codeHash);

        if (backupIndex === -1) {
          throw new ApiError(400, "Invalid verification code");
        }

        // Remove used backup code
        const updatedCodes = [...backupCodes];
        updatedCodes.splice(backupIndex, 1);
        await db
          .update(users)
          .set({ mfaBackupCodes: updatedCodes })
          .where(eq(users.id, userId));
      }

      const token = generateToken(user.id);

      return reply.send({ token });
    }
  );

  // Disable MFA
  app.post(
    "/auth/mfa/disable",
    { preHandler: [authMiddleware, createRateLimiter("auth")] },
    async (request, reply) => {
      const body = disableSchema.parse(request.body);

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, request.userId))
        .limit(1);

      if (!user) throw new ApiError(404, "User not found");
      if (!user.mfaEnabled) throw new ApiError(400, "MFA is not enabled");

      const passwordValid = await verifyPassword(body.password, user.passwordHash);
      if (!passwordValid) {
        throw new ApiError(401, "Invalid password");
      }

      await db
        .update(users)
        .set({
          mfaEnabled: false,
          mfaSecret: null,
          mfaBackupCodes: null,
        })
        .where(eq(users.id, request.userId));

      return reply.send({ disabled: true });
    }
  );
}
