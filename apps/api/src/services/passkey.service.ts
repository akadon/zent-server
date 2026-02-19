import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { redis } from "../config/redis.js";
import crypto from "crypto";

export interface PasskeyCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceType: string | null;
  backedUp: boolean;
  transports: string[] | null;
  aaguid: string | null;
  createdAt: Date;
}

const CHALLENGE_TTL = 5 * 60; // 5 minutes

// Challenge storage using Redis for distributed access
export async function createChallenge(userId: string = ""): Promise<string> {
  const challenge = crypto.randomBytes(32).toString("base64url");
  await redis.setex(`passkey:challenge:${challenge}`, CHALLENGE_TTL, userId);
  return challenge;
}

export async function validateChallenge(challenge: string): Promise<string | null> {
  const userId = await redis.get(`passkey:challenge:${challenge}`);
  if (userId !== null) {
    await redis.del(`passkey:challenge:${challenge}`);
    return userId;
  }
  return null;
}

export async function getUserCredentials(userId: string): Promise<PasskeyCredential[]> {
  return db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.userId, userId));
}

export async function getCredentialByCredentialId(
  credentialId: string
): Promise<(PasskeyCredential & { userId: string }) | null> {
  const [credential] = await db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.credentialId, credentialId))
    .limit(1);

  return credential ?? null;
}

export async function createCredential(
  userId: string,
  data: {
    credentialId: string;
    publicKey: string;
    deviceType?: string;
    transports?: string[];
    aaguid?: string;
  }
): Promise<PasskeyCredential> {
  // Check if credential already exists
  const existing = await getCredentialByCredentialId(data.credentialId);
  if (existing) {
    throw new ApiError(409, "Credential already registered");
  }

  const id = generateSnowflake();

  await db
    .insert(schema.passkeyCredentials)
    .values({
      id,
      userId,
      credentialId: data.credentialId,
      publicKey: data.publicKey,
      counter: 0,
      deviceType: data.deviceType ?? null,
      transports: data.transports ?? null,
      aaguid: data.aaguid ?? null,
    });

  const [credential] = await db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.id, id))
    .limit(1);

  if (!credential) {
    throw new ApiError(500, "Failed to create credential");
  }

  return credential;
}

export async function updateCredentialCounter(
  credentialId: string
): Promise<void> {
  // First get current counter
  const [current] = await db
    .select({ counter: schema.passkeyCredentials.counter })
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.credentialId, credentialId))
    .limit(1);

  if (current) {
    await db
      .update(schema.passkeyCredentials)
      .set({
        counter: current.counter + 1,
      })
      .where(eq(schema.passkeyCredentials.credentialId, credentialId));
  }
}

export async function deleteCredential(
  userId: string,
  credentialId: string
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.passkeyCredentials)
    .where(
      and(
        eq(schema.passkeyCredentials.userId, userId),
        eq(schema.passkeyCredentials.credentialId, credentialId)
      )
    )
    .limit(1);

  if (!existing) {
    throw new ApiError(404, "Passkey not found");
  }

  await db
    .delete(schema.passkeyCredentials)
    .where(
      and(
        eq(schema.passkeyCredentials.userId, userId),
        eq(schema.passkeyCredentials.credentialId, credentialId)
      )
    );
}

export async function authenticateWithCredential(
  credentialId: string,
  challenge: string
): Promise<string> {
  // Validate challenge
  const challengeUserId = await validateChallenge(challenge);
  if (challengeUserId === null) {
    throw new ApiError(400, "Challenge expired or invalid");
  }

  // Find credential
  const credential = await getCredentialByCredentialId(credentialId);
  if (!credential) {
    throw new ApiError(401, "Unknown credential");
  }

  // Update counter and last used
  await updateCredentialCounter(credentialId);

  return credential.userId;
}
