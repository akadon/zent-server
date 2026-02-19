import { eq, and, gt } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { ApiError } from "./auth.service.js";
import crypto from "crypto";

function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("base64url");
}

export async function createInvite(
  guildId: string,
  channelId: string,
  inviterId: string,
  options?: {
    maxAge?: number;
    maxUses?: number;
    temporary?: boolean;
  }
) {
  const maxAge = options?.maxAge ?? 86400; // 24h
  const code = generateInviteCode();

  const expiresAt =
    maxAge > 0 ? new Date(Date.now() + maxAge * 1000) : null;

  await db
    .insert(schema.invites)
    .values({
      code,
      guildId,
      channelId,
      inviterId,
      maxAge,
      maxUses: options?.maxUses ?? 0,
      temporary: options?.temporary ?? false,
      expiresAt,
    });

  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.code, code))
    .limit(1);

  return invite!;
}

export async function getInvite(code: string) {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.code, code))
    .limit(1);

  if (!invite) throw new ApiError(404, "Invite not found or expired");

  // Check expiry
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    await db.delete(schema.invites).where(eq(schema.invites.code, code));
    throw new ApiError(404, "Invite expired");
  }

  // Check max uses
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    await db.delete(schema.invites).where(eq(schema.invites.code, code));
    throw new ApiError(404, "Invite max uses reached");
  }

  return invite;
}

export async function useInvite(code: string, userId: string) {
  const invite = await getInvite(code);

  // Check if already a member
  const [existing] = await db
    .select()
    .from(schema.members)
    .where(
      and(
        eq(schema.members.userId, userId),
        eq(schema.members.guildId, invite.guildId)
      )
    )
    .limit(1);

  if (existing) {
    return { guildId: invite.guildId, alreadyMember: true };
  }

  // Check ban
  const [ban] = await db
    .select()
    .from(schema.bans)
    .where(
      and(eq(schema.bans.guildId, invite.guildId), eq(schema.bans.userId, userId))
    )
    .limit(1);

  if (ban) throw new ApiError(403, "You are banned from this guild");

  // Add member and increment uses
  await db.transaction(async (tx) => {
    await tx.insert(schema.members).values({
      userId,
      guildId: invite.guildId,
    });

    await tx
      .update(schema.invites)
      .set({ uses: invite.uses + 1 })
      .where(eq(schema.invites.code, code));
  });

  return { guildId: invite.guildId, alreadyMember: false };
}

export async function getGuildInvites(guildId: string) {
  return db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.guildId, guildId));
}

export async function deleteInvite(code: string) {
  const [existing] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.code, code))
    .limit(1);

  if (!existing) throw new ApiError(404, "Invite not found");

  await db
    .delete(schema.invites)
    .where(eq(schema.invites.code, code));
}
