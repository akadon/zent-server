import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as relationshipService from "../../services/relationship.service.js";
import * as userNotesService from "../../services/user-notes.service.js";
import * as notificationService from "../../services/notification.service.js";
import { ApiError, getUserById } from "../../services/auth.service.js";
import { dispatchUser } from "../../utils/dispatch.js";
import { memberRepository } from "../../repositories/member.repository.js";
import { guildRepository } from "../../repositories/guild.repository.js";
import { relationshipRepository } from "../../repositories/relationship.repository.js";
import { userRepository } from "../../repositories/user.repository.js";

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ── Relationships (Friends/Blocks) ──

  app.get("/users/@me/relationships", async (request, reply) => {
    const relationships = await relationshipService.getRelationships(request.userId);
    return reply.send(relationships);
  });

  // Send friend request (by user ID)
  app.post("/users/@me/relationships", async (request, reply) => {
    const body = z
      .object({
        userId: z.string(),
      })
      .parse(request.body);

    const target = await getUserById(body.userId);
    if (!target) throw new ApiError(404, "User not found");

    const result = await relationshipService.sendFriendRequest(request.userId, body.userId);

    // Dispatch to both users: target gets incoming (type 3), sender gets outgoing (type 4)
    await Promise.all([
      dispatchUser(body.userId, "RELATIONSHIP_ADD", { userId: request.userId, type: 3 }),
      dispatchUser(request.userId, "RELATIONSHIP_ADD", { userId: body.userId, type: 4 }),
    ]);

    // Notify target about the friend request
    const sender = await getUserById(request.userId);
    notificationService.createNotification(body.userId, "friend_request", "New friend request", {
      body: `${sender?.username ?? "Someone"} sent you a friend request`,
      sourceUserId: request.userId,
    }).catch(() => {}); // fire and forget

    return reply.status(201).send(result);
  });

  // Accept friend request
  app.put("/users/@me/relationships/:targetId", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    await relationshipService.acceptFriendRequest(request.userId, targetId);

    // Dispatch to both users: both become friends (type 1)
    await Promise.all([
      dispatchUser(targetId, "RELATIONSHIP_ADD", { userId: request.userId, type: 1 }),
      dispatchUser(request.userId, "RELATIONSHIP_ADD", { userId: targetId, type: 1 }),
    ]);

    return reply.status(204).send();
  });

  // Remove friend / cancel request
  app.delete("/users/@me/relationships/:targetId", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    await relationshipService.removeFriend(request.userId, targetId);

    // Dispatch to both users
    await Promise.all([
      dispatchUser(targetId, "RELATIONSHIP_REMOVE", { userId: request.userId }),
      dispatchUser(request.userId, "RELATIONSHIP_REMOVE", { userId: targetId }),
    ]);

    return reply.status(204).send();
  });

  // Block user
  app.put("/users/:targetId/block", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    await relationshipService.blockUser(request.userId, targetId);

    // Target sees relationship removed, blocker sees block (type 2)
    await Promise.all([
      dispatchUser(targetId, "RELATIONSHIP_REMOVE", { userId: request.userId }),
      dispatchUser(request.userId, "RELATIONSHIP_ADD", { userId: targetId, type: 2 }),
    ]);

    return reply.status(204).send();
  });

  // Unblock user
  app.delete("/users/:targetId/block", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    await relationshipService.unblockUser(request.userId, targetId);

    // Blocker sees block removed
    await dispatchUser(request.userId, "RELATIONSHIP_REMOVE", { userId: targetId });

    return reply.status(204).send();
  });

  // ── DM Channels ──

  app.get("/users/@me/channels", async (request, reply) => {
    const channels = await relationshipService.getUserDMChannels(request.userId);
    return reply.send(channels);
  });

  app.post("/users/@me/channels", async (request, reply) => {
    const body = z
      .object({
        recipientId: z.string(),
      })
      .parse(request.body);

    const channel = await relationshipService.getOrCreateDMChannel(
      request.userId,
      body.recipientId
    );

    return reply.status(200).send(channel);
  });

  // ── User lookup ──

  app.get("/users/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const user = await getUserById(userId);
    if (!user) throw new ApiError(404, "User not found");
    return reply.send({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      banner: user.banner,
      bio: user.bio,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    });
  });

  // ── User Notes ──

  // Get note about a specific user
  app.get("/users/:userId/note", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const note = await userNotesService.getNote(request.userId, userId);
    return reply.send({ note: note?.note ?? null });
  });

  // Set note about a specific user
  app.put("/users/:userId/note", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = z
      .object({
        note: z.string().max(256),
      })
      .parse(request.body);

    // Verify target user exists
    const targetUser = await getUserById(userId);
    if (!targetUser) throw new ApiError(404, "User not found");

    if (body.note.trim() === "") {
      // Empty note means delete
      await userNotesService.deleteNote(request.userId, userId);
      return reply.send({ note: null });
    }

    const result = await userNotesService.setNote(request.userId, userId, body.note);
    return reply.send({ note: result.note });
  });

  // Delete note about a specific user
  app.delete("/users/:userId/note", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await userNotesService.deleteNote(request.userId, userId);
    return reply.status(204).send();
  });

  // Get all notes
  app.get("/users/@me/notes", async (request, reply) => {
    const notes = await userNotesService.getAllNotes(request.userId);
    // Return as object keyed by target user ID
    const notesMap: Record<string, string> = {};
    for (const note of notes) {
      notesMap[note.targetUserId] = note.note;
    }
    return reply.send(notesMap);
  });

  // ── User Profile ──

  app.get("/users/:userId/profile", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const user = await getUserById(userId);
    if (!user) throw new ApiError(404, "User not found");

    // Find mutual guilds: guilds where both users are members
    const [myGuilds, theirGuilds] = await Promise.all([
      memberRepository.findGuildIdsByUserId(request.userId),
      memberRepository.findGuildIdsByUserId(userId),
    ]);
    const theirGuildSet = new Set(theirGuilds.map((g) => g.guildId));
    const mutualGuildIds = myGuilds.map((g) => g.guildId).filter((id) => theirGuildSet.has(id));

    let mutualGuilds: Array<{ id: string; name: string; icon: string | null }> = [];
    if (mutualGuildIds.length > 0) {
      const guilds = await guildRepository.findByIds(mutualGuildIds);
      mutualGuilds = guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon }));
    }

    // Find mutual friends: users who are friends (type 1) with both request.userId and userId
    const [myFriends, theirFriends] = await Promise.all([
      relationshipRepository.findFriendIds(request.userId),
      relationshipRepository.findFriendIds(userId),
    ]);
    const theirFriendSet = new Set(theirFriends.map((f) => f.targetId));
    const mutualFriendIds = myFriends.map((f) => f.targetId).filter((id) => theirFriendSet.has(id));

    let mutualFriends: Array<{ id: string; username: string; avatar: string | null }> = [];
    if (mutualFriendIds.length > 0) {
      const users = await userRepository.findPublicByIds(mutualFriendIds);
      mutualFriends = users.map((u) => ({ id: u.id, username: u.username, avatar: u.avatar }));
    }

    return reply.send({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        banner: user.banner,
        bio: user.bio,
        flags: user.flags,
        premiumType: user.premiumType,
      },
      connectedAccounts: [],
      premiumSince: null,
      premiumGuildSince: null,
      mutualGuilds,
      mutualFriends,
    });
  });
}
