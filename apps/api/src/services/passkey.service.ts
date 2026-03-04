import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";
import { passkeyRepository } from "../repositories/passkey.repository.js";
import crypto from "crypto";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

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
  return passkeyRepository.findByUserId(userId);
}

export async function getCredentialByCredentialId(
  credentialId: string
): Promise<(PasskeyCredential & { userId: string }) | null> {
  return passkeyRepository.findByCredentialId(credentialId);
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

  await passkeyRepository.create({
    id,
    userId,
    credentialId: data.credentialId,
    publicKey: data.publicKey,
    counter: 0,
    deviceType: data.deviceType ?? null,
    transports: data.transports ?? null,
    aaguid: data.aaguid ?? null,
  });

  const credential = await passkeyRepository.findById(id);
  if (!credential) {
    throw new ApiError(500, "Failed to create credential");
  }

  return credential;
}

/**
 * Verify a registration response and create the credential.
 */
export async function verifyAndCreateCredential(
  userId: string,
  challenge: string,
  response: any
): Promise<PasskeyCredential> {
  const challengeUserId = await validateChallenge(challenge);
  if (challengeUserId === null) {
    throw new ApiError(400, "Challenge expired or invalid");
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: env.RP_ORIGIN,
    expectedRPID: env.RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new ApiError(400, "Registration verification failed");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  return createCredential(userId, {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    deviceType: credentialDeviceType,
    transports: response.response.transports ?? [],
    aaguid: verification.registrationInfo.aaguid,
  });
}

export async function updateCredentialCounter(
  credentialId: string
): Promise<void> {
  await passkeyRepository.incrementCounterByCredentialId(credentialId);
}

export async function deleteCredential(
  userId: string,
  credentialId: string
): Promise<void> {
  const existing = await passkeyRepository.findByCredentialId(credentialId);
  if (!existing || existing.userId !== userId) {
    throw new ApiError(404, "Passkey not found");
  }

  await passkeyRepository.deleteByUserAndCredentialId(userId, credentialId);
}

/**
 * Authenticate with a WebAuthn credential - now with proper cryptographic verification.
 */
export async function authenticateWithCredential(
  credentialId: string,
  challenge: string,
  authResponse: any
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

  // Verify the assertion cryptographically
  const verification = await verifyAuthenticationResponse({
    response: authResponse,
    expectedChallenge: challenge,
    expectedOrigin: env.RP_ORIGIN,
    expectedRPID: env.RP_ID,
    credential: {
      id: credential.credentialId,
      publicKey: Buffer.from(credential.publicKey, "base64url"),
      counter: credential.counter,
      transports: credential.transports as any,
    },
  });

  if (!verification.verified) {
    throw new ApiError(401, "Passkey verification failed");
  }

  // Update counter to prevent replay attacks
  await updateCredentialCounter(credentialId);

  return credential.userId;
}
