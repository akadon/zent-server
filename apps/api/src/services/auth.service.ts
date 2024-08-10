import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../config/env.js";
import { generateSnowflake } from "@yxc/snowflake";

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = "7d";

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

export async function register(email: string, username: string, password: string) {
  // Check existing
  const existingEmail = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);

  if (existingEmail.length > 0) {
    throw new ApiError(409, "Email already registered");
  }

  const existingUsername = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  if (existingUsername.length > 0) {
    throw new ApiError(409, "Username taken");
  }

  const id = generateSnowflake();
  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(schema.users)
    .values({
      id,
      email: email.toLowerCase(),
      username,
      passwordHash,
    })
    .returning({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      email: schema.users.email,
      avatar: schema.users.avatar,
      banner: schema.users.banner,
      bio: schema.users.bio,
      status: schema.users.status,
      customStatus: schema.users.customStatus,
      mfaEnabled: schema.users.mfaEnabled,
      verified: schema.users.verified,
      flags: schema.users.flags,
      premiumType: schema.users.premiumType,
      locale: schema.users.locale,
      createdAt: schema.users.createdAt,
    });

  const token = generateToken(user!.id);
  return { token, user: { ...user!, createdAt: user!.createdAt.toISOString() } };
}

export async function login(email: string, password: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, "Invalid email or password");
  }

  const token = generateToken(user.id);

  return {
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

export async function getUserById(userId: string) {
  const [user] = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      email: schema.users.email,
      avatar: schema.users.avatar,
      banner: schema.users.banner,
      bio: schema.users.bio,
      status: schema.users.status,
      customStatus: schema.users.customStatus,
      mfaEnabled: schema.users.mfaEnabled,
      verified: schema.users.verified,
      flags: schema.users.flags,
      premiumType: schema.users.premiumType,
      locale: schema.users.locale,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return user ?? null;
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
