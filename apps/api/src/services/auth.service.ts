import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { generateSnowflake } from "@yxc/snowflake";
import { redis } from "../config/redis.js";
import { userRepository } from "../repositories/user.repository.js";

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = "7d";
const MFA_TICKET_EXPIRY = "5m";

export interface TokenPayload {
  userId: string;
  tokenVersion?: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function generateToken(userId: string): Promise<string> {
  const versionStr = await redis.get(`user:token_version:${userId}`);
  const tokenVersion = versionStr ? parseInt(versionStr, 10) : 0;
  return jwt.sign({ userId, tokenVersion } satisfies TokenPayload, env.AUTH_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const payload = jwt.verify(token, env.AUTH_SECRET) as TokenPayload;

  // Check if token has been revoked (individual token)
  const revoked = await redis.get(`token:revoked:${token}`);
  if (revoked) {
    throw new ApiError(401, "Token has been revoked");
  }

  // Check token version against Redis (covers revokeAllUserTokens)
  const currentVersionStr = await redis.get(`user:token_version:${payload.userId}`);
  const currentVersion = currentVersionStr ? parseInt(currentVersionStr, 10) : 0;
  const tokenVersion = payload.tokenVersion ?? 0;
  if (tokenVersion < currentVersion) {
    throw new ApiError(401, "Token has been revoked");
  }

  return payload;
}

/**
 * Revoke a JWT token. Stores in Redis until the token's original expiry.
 */
export async function revokeToken(token: string): Promise<void> {
  try {
    const decoded = jwt.decode(token) as any;
    const exp = decoded?.exp;
    if (exp) {
      const ttl = exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redis.setex(`token:revoked:${token}`, ttl, "1");
      }
    }
  } catch {
    // Token already invalid, nothing to revoke
  }
}

/**
 * Revoke all tokens for a user by incrementing their token version.
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await redis.incr(`user:token_version:${userId}`);
}

export function generateMfaTicket(userId: string): string {
  return jwt.sign({ userId, mfa: true }, env.AUTH_SECRET, {
    expiresIn: MFA_TICKET_EXPIRY,
  });
}

export function verifyMfaTicket(ticket: string): TokenPayload {
  const payload = jwt.verify(ticket, env.AUTH_SECRET) as TokenPayload & { mfa?: boolean };
  if (!payload.mfa) {
    throw new ApiError(400, "Invalid MFA ticket");
  }
  return { userId: payload.userId };
}

export async function register(email: string, username: string, password: string) {
  // Check existing
  const existingEmail = await userRepository.findByEmail(email.toLowerCase());
  if (existingEmail) {
    throw new ApiError(409, "Email already registered");
  }

  const existingUsername = await userRepository.findByUsername(username);
  if (existingUsername) {
    throw new ApiError(409, "Username taken");
  }

  const id = generateSnowflake();
  const passwordHash = await hashPassword(password);

  const user = await userRepository.create({
    id,
    email: email.toLowerCase(),
    username,
    passwordHash,
  });

  const token = await generateToken(user.id);
  return { token, user: { ...user, createdAt: user.createdAt.toISOString() } };
}

export async function login(email: string, password: string) {
  const user = await userRepository.findByEmail(email.toLowerCase());

  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, "Invalid email or password");
  }

  // If MFA is enabled, return a short-lived ticket instead of a full token
  if (user.mfaEnabled) {
    const ticket = generateMfaTicket(user.id);
    return {
      mfa: true,
      ticket,
      token: null,
      user: null,
    };
  }

  const token = await generateToken(user.id);

  return {
    mfa: false,
    ticket: null,
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatar: user.avatar,
      banner: user.banner,
      bio: user.bio,
      status: user.status,
      customStatus: user.customStatus,
      mfaEnabled: user.mfaEnabled,
      verified: user.verified,
      flags: user.flags,
      premiumType: user.premiumType,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
    },
  };
}

const USER_CACHE_TTL = 60; // seconds

export async function getUserById(userId: string) {
  const cacheKey = `user:${userId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    parsed.createdAt = new Date(parsed.createdAt);
    return parsed;
  }

  const user = await userRepository.findById(userId);

  if (user) {
    await redis.set(cacheKey, JSON.stringify(user), "EX", USER_CACHE_TTL);
  }

  return user;
}

export async function invalidateUserCache(userId: string) {
  await redis.del(`user:${userId}`);
}

// ── Guest login ──

export async function guestLogin() {
  const id = generateSnowflake();
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 hex chars
  const username = `Guest_${suffix}`;
  const guestExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const user = await userRepository.create({
    id,
    email: `guest_${id}@guest.local`,
    username,
    passwordHash: "",
    isGuest: true,
    guestExpiresAt,
  });

  const token = await generateToken(user.id);
  const { passwordHash: _, mfaSecret: _s, mfaBackupCodes: _b, ...safeUser } = user;
  return { token, user: { ...safeUser, createdAt: user.createdAt.toISOString() } };
}

export async function claimGuestAccount(
  userId: string,
  email: string,
  username: string,
  password: string
) {
  const user = await userRepository.findById(userId);
  if (!user || !user.isGuest) {
    throw new ApiError(400, "Not a guest account");
  }

  const existingEmail = await userRepository.findByEmail(email.toLowerCase());
  if (existingEmail) {
    throw new ApiError(409, "Email already registered");
  }

  const existingUsername = await userRepository.findByUsername(username);
  if (existingUsername && existingUsername.id !== userId) {
    throw new ApiError(409, "Username taken");
  }

  const passwordHash = await hashPassword(password);
  await userRepository.update(userId, {
    email: email.toLowerCase(),
    username,
    passwordHash,
    isGuest: false,
    guestExpiresAt: null,
  });

  await invalidateUserCache(userId);

  const updated = await userRepository.findById(userId);
  if (!updated) throw new ApiError(500, "Failed to update account");
  const { passwordHash: _, mfaSecret: _s, mfaBackupCodes: _b, ...safeUser } = updated;
  return safeUser;
}

// ── Error class ──
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}
