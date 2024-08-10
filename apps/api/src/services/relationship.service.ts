import { eq, and, or } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { ChannelType } from "@yxc/types";

// Relationship types: 1=friend, 2=blocked, 3=incoming_request, 4=outgoing_request

export async function sendFriendRequest(userId: string, targetId: string) {
  if (userId === targetId) throw new ApiError(400, "Cannot friend yourself");

  // Check if already related
  const [existing] = await db
    .select()
    .from(schema.relationships)
    .where(
      and(
        eq(schema.relationships.userId, userId),
        eq(schema.relationships.targetId, targetId)
      )
    )
    .limit(1);

  if (existing) {
    if (existing.type === 1) throw new ApiError(400, "Already friends");
    if (existing.type === 2) throw new ApiError(400, "User is blocked");
    if (existing.type === 4) throw new ApiError(400, "Friend request already sent");
  }

  // Check if target has a pending request from us (accept it)
  const [incomingFromTarget] = await db
    .select()
    .from(schema.relationships)
    .where(
      and(
        eq(schema.relationships.userId, targetId),
        eq(schema.relationships.targetId, userId),
        eq(schema.relationships.type, 4) // target sent us a request
      )
    )
    .limit(1);

  if (incomingFromTarget) {
    // Accept: convert both sides to friends
    await db.transaction(async (tx) => {
      await tx
        .update(schema.relationships)
        .set({ type: 1 })
        .where(
          and(
            eq(schema.relationships.userId, targetId),
            eq(schema.relationships.targetId, userId)
          )
        );

      // Replace incoming with friend
      if (existing) {
        await tx
          .update(schema.relationships)
          .set({ type: 1 })
          .where(
            and(
              eq(schema.relationships.userId, userId),
              eq(schema.relationships.targetId, targetId)
            )
          );
      } else {
        await tx.insert(schema.relationships).values({
          userId,
          targetId,
          type: 1,
        });
      }
    });

    return { type: 1, accepted: true };
  }

  // Create outgoing request (4) for sender, incoming (3) for receiver
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.relationships)
      .values({ userId, targetId, type: 4 })
      .onConflictDoUpdate({
        target: [schema.relationships.userId, schema.relationships.targetId],
        set: { type: 4 },
      });

    await tx
      .insert(schema.relationships)
      .values({ userId: targetId, targetId: userId, type: 3 })
      .onConflictDoUpdate({
        target: [schema.relationships.userId, schema.relationships.targetId],
        set: { type: 3 },
      });
  });

  return { type: 4, accepted: false };
}

export async function acceptFriendRequest(userId: string, targetId: string) {
  const [incoming] = await db
    .select()
    .from(schema.relationships)
    .where(
      and(
        eq(schema.relationships.userId, userId),
        eq(schema.relationships.targetId, targetId),
        eq(schema.relationships.type, 3) // incoming request
      )
    )
    .limit(1);

  if (!incoming) throw new ApiError(404, "No pending friend request");

  await db.transaction(async (tx) => {
    await tx
      .update(schema.relationships)
      .set({ type: 1 })
      .where(
        and(
          eq(schema.relationships.userId, userId),
          eq(schema.relationships.targetId, targetId)
        )
      );
    await tx
      .update(schema.relationships)
      .set({ type: 1 })
      .where(
        and(
          eq(schema.relationships.userId, targetId),
          eq(schema.relationships.targetId, userId)
        )
      );
  });
}

export async function removeFriend(userId: string, targetId: string) {
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.relationships)
      .where(
        and(
          eq(schema.relationships.userId, userId),
          eq(schema.relationships.targetId, targetId)
        )
      );
    await tx
      .delete(schema.relationships)
      .where(
        and(
          eq(schema.relationships.userId, targetId),
          eq(schema.relationships.targetId, userId)
        )
      );
  });
}

export async function blockUser(userId: string, targetId: string) {
  if (userId === targetId) throw new ApiError(400, "Cannot block yourself");

  await db.transaction(async (tx) => {
    // Remove any existing relationship from both sides
    await tx
      .delete(schema.relationships)
      .where(
        and(
          eq(schema.relationships.userId, targetId),
          eq(schema.relationships.targetId, userId)
        )
      );

    // Upsert block
    await tx
      .insert(schema.relationships)
      .values({ userId, targetId, type: 2 })
      .onConflictDoUpdate({
        target: [schema.relationships.userId, schema.relationships.targetId],
        set: { type: 2 },
      });
  });
}

export async function unblockUser(userId: string, targetId: string) {
  const [existing] = await db
    .select()
    .from(schema.relationships)
    .where(
      and(
        eq(schema.relationships.userId, userId),
        eq(schema.relationships.targetId, targetId),
        eq(schema.relationships.type, 2)
      )
    )
    .limit(1);

  if (!existing) throw new ApiError(404, "User is not blocked");

  await db
    .delete(schema.relationships)
    .where(
      and(
        eq(schema.relationships.userId, userId),
        eq(schema.relationships.targetId, targetId)
      )
    );
}

export async function getRelationships(userId: string) {
  const rels = await db
    .select()
    .from(schema.relationships)
    .where(eq(schema.relationships.userId, userId));

  const result = [];
  for (const rel of rels) {
    const [user] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
        status: schema.users.status,
      })
      .from(schema.users)
      .where(eq(schema.users.id, rel.targetId))
      .limit(1);

    if (user) {
      result.push({
        id: rel.targetId,
        type: rel.type,
        user,
      });
    }
  }

  return result;
}

// ── DM Channels ──

export async function getOrCreateDMChannel(userId: string, recipientId: string) {
  // Find existing DM channel between the two users
  const userDMs = await db
    .select({ channelId: schema.dmChannels.channelId })
    .from(schema.dmChannels)
    .where(eq(schema.dmChannels.userId, userId));

  for (const dm of userDMs) {
    const [recipientDM] = await db
      .select()
      .from(schema.dmChannels)
      .where(
        and(
          eq(schema.dmChannels.channelId, dm.channelId),
          eq(schema.dmChannels.userId, recipientId)
        )
      )
      .limit(1);

    if (recipientDM) {
      const channel = await db
        .select()
        .from(schema.channels)
        .where(eq(schema.channels.id, dm.channelId))
        .limit(1);
      if (channel[0] && channel[0].type === ChannelType.DM) {
        return { ...channel[0], createdAt: channel[0].createdAt.toISOString() };
      }
    }
  }

  // Create new DM channel
  const channelId = generateSnowflake();
  await db.transaction(async (tx) => {
    await tx.insert(schema.channels).values({
      id: channelId,
      type: ChannelType.DM,
      name: null,
      position: 0,
    });

    await tx.insert(schema.dmChannels).values([
      { channelId, userId },
      { channelId, userId: recipientId },
    ]);
  });

  const [channel] = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .limit(1);

  return { ...channel!, createdAt: channel!.createdAt.toISOString() };
}

export async function getUserDMChannels(userId: string) {
  const dmEntries = await db
    .select({ channelId: schema.dmChannels.channelId })
    .from(schema.dmChannels)
    .where(eq(schema.dmChannels.userId, userId));

  const channels = [];
  for (const entry of dmEntries) {
    const [channel] = await db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, entry.channelId))
      .limit(1);

    if (!channel) continue;

    // Get recipients
    const recipients = await db
      .select({ userId: schema.dmChannels.userId })
      .from(schema.dmChannels)
      .where(eq(schema.dmChannels.channelId, entry.channelId));

    const users = [];
    for (const r of recipients) {
      if (r.userId === userId) continue;
      const [user] = await db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          avatar: schema.users.avatar,
          status: schema.users.status,
        })
        .from(schema.users)
        .where(eq(schema.users.id, r.userId))
        .limit(1);
      if (user) users.push(user);
    }

    channels.push({
      ...channel,
      createdAt: channel.createdAt.toISOString(),
      recipients: users,
    });
  }

  return channels;
}
