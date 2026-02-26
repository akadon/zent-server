import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { ChannelType } from "@yxc/types";
import { relationshipRepository } from "../repositories/relationship.repository.js";
import { channelRepository } from "../repositories/channel.repository.js";
import { userRepository } from "../repositories/user.repository.js";

// Relationship types: 1=friend, 2=blocked, 3=incoming_request, 4=outgoing_request

export async function sendFriendRequest(userId: string, targetId: string) {
  if (userId === targetId) throw new ApiError(400, "Cannot friend yourself");

  // Check if already related
  const existing = await relationshipRepository.findByUserAndTarget(userId, targetId);

  if (existing) {
    if (existing.type === 1) throw new ApiError(400, "Already friends");
    if (existing.type === 2) throw new ApiError(400, "User is blocked");
    if (existing.type === 4) throw new ApiError(400, "Friend request already sent");
  }

  // Check if target has a pending request from us (accept it)
  const incomingFromTarget = await relationshipRepository.findByUserAndTargetWithType(targetId, userId, 4);

  if (incomingFromTarget) {
    // Accept: convert both sides to friends
    await relationshipRepository.acceptFriendRequest(userId, targetId, !!existing);
    return { type: 1, accepted: true };
  }

  // Create outgoing request (4) for sender, incoming (3) for receiver
  await relationshipRepository.sendFriendRequest(userId, targetId);

  return { type: 4, accepted: false };
}

export async function acceptFriendRequest(userId: string, targetId: string) {
  const incoming = await relationshipRepository.findByUserAndTargetWithType(userId, targetId, 3);

  if (!incoming) throw new ApiError(404, "No pending friend request");

  await relationshipRepository.acceptBothSides(userId, targetId);
}

export async function removeFriend(userId: string, targetId: string) {
  await relationshipRepository.removeBothSides(userId, targetId);
}

export async function blockUser(userId: string, targetId: string) {
  if (userId === targetId) throw new ApiError(400, "Cannot block yourself");

  await relationshipRepository.blockUser(userId, targetId);
}

export async function unblockUser(userId: string, targetId: string) {
  const existing = await relationshipRepository.findByUserAndTargetWithType(userId, targetId, 2);

  if (!existing) throw new ApiError(404, "User is not blocked");

  await relationshipRepository.delete(userId, targetId);
}

export async function getRelationships(userId: string) {
  const rels = await relationshipRepository.findOutgoingByUserId(userId);

  if (rels.length === 0) return [];

  const targetIds = rels.map((r) => r.targetId);
  const users = await userRepository.findPublicByIds(targetIds);

  const userMap = new Map(users.map((u) => [u.id, u]));

  return rels
    .filter((rel) => userMap.has(rel.targetId))
    .map((rel) => ({
      id: rel.targetId,
      type: rel.type,
      user: userMap.get(rel.targetId)!,
    }));
}

// ── DM Channels ──

export async function getOrCreateDMChannel(userId: string, recipientId: string) {
  // Find existing DM channel between the two users
  const userDMChannelIds = await channelRepository.findDMChannelIdsByUserId(userId);

  for (const channelId of userDMChannelIds) {
    const recipientDM = await channelRepository.findDMRecipient(channelId, recipientId);

    if (recipientDM) {
      const channel = await channelRepository.findById(channelId);
      if (channel && channel.type === ChannelType.DM) {
        return { ...channel, createdAt: channel.createdAt.toISOString() };
      }
    }
  }

  // Create new DM channel
  const channelId = generateSnowflake();
  await channelRepository.createDMChannel(channelId, ChannelType.DM, [userId, recipientId]);

  const channel = await channelRepository.findById(channelId);

  return { ...channel!, createdAt: channel!.createdAt.toISOString() };
}

export async function getUserDMChannels(userId: string) {
  const channelIds = await channelRepository.findDMChannelIdsByUserId(userId);

  if (channelIds.length === 0) return [];

  // Batch fetch all channels
  const channelList = await channelRepository.findByIds(channelIds);

  const channelMap = new Map(channelList.map((c) => [c.id, c]));

  // Batch fetch all dm_channel rows for these channels (to find recipients)
  const allDmRows = await channelRepository.findDMParticipantsByChannelIds(channelIds);

  // Collect all recipient user IDs (excluding self)
  const recipientUserIds = new Set<string>();
  const recipientsByChannel = new Map<string, string[]>();
  for (const row of allDmRows) {
    if (row.userId === userId) continue;
    recipientUserIds.add(row.userId);
    const list = recipientsByChannel.get(row.channelId) ?? [];
    list.push(row.userId);
    recipientsByChannel.set(row.channelId, list);
  }

  // Batch fetch all recipient users
  const userList = recipientUserIds.size > 0
    ? await userRepository.findPublicByIds([...recipientUserIds])
    : [];

  const userMap = new Map(userList.map((u) => [u.id, u]));

  return channelIds
    .map((channelId) => {
      const channel = channelMap.get(channelId);
      if (!channel) return null;
      const recipientIds = recipientsByChannel.get(channelId) ?? [];
      const recipients = recipientIds
        .map((id) => userMap.get(id))
        .filter((u): u is NonNullable<typeof u> => u != null);
      return {
        ...channel,
        createdAt: channel.createdAt.toISOString(),
        recipients,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null);
}
