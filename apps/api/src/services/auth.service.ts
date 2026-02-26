import bcrypt from "bcrypt";
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
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId } satisfies TokenPayload, env.AUTH_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.AUTH_SECRET) as TokenPayload;
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

  const token = generateToken(user.id);
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

  const token = generateToken(user.id);

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
