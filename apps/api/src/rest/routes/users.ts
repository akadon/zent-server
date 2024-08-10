import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as relationshipService from "../../services/relationship.service.js";
import * as userNotesService from "../../services/user-notes.service.js";
import { ApiError, getUserById } from "../../services/auth.service.js";
import { redisPub } from "../../config/redis.js";

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

    // Dispatch to both users
    await redisPub.publish(
      `gateway:user:${body.userId}`,
      JSON.stringify({
        event: "RELATIONSHIP_ADD",
        data: { userId: request.userId, type: 3 },
      })
    );

    return reply.status(201).send(result);
  });

  // Accept friend request
  app.put("/users/@me/relationships/:targetId", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    await relationshipService.acceptFriendRequest(request.userId, targetId);

    await redisPub.publish(
      `gateway:user:${targetId}`,
      JSON.stringify({
        event: "RELATIONSHIP_ADD",
        data: { userId: request.userId, type: 1 },
      })
    );

    return reply.status(204).send();
  });

  // Remove friend / cancel request
  app.delete("/users/@me/relationships/:targetId", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    await relationshipService.removeFriend(request.userId, targetId);

    await redisPub.publish(
      `gateway:user:${targetId}`,
      JSON.stringify({
        event: "RELATIONSHIP_REMOVE",
        data: { userId: request.userId },
      })
    );

    return reply.status(204).send();
  });

  // Block user
  app.put("/users/:targetId/block", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    await relationshipService.blockUser(request.userId, targetId);
    return reply.status(204).send();
  });

  // Unblock user
  app.delete("/users/:targetId/block", async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    await relationshipService.unblockUser(request.userId, targetId);
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

    // Get mutual guilds and friends (would need additional service methods)
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
      connectedAccounts: [], // Placeholder for connected accounts feature
      premiumSince: null,
      premiumGuildSince: null,
      mutualGuilds: [], // Would need to implement mutual guild lookup
      mutualFriends: [], // Would need to implement mutual friends lookup
    });
  });
}
