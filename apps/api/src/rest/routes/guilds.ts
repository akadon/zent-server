import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as guildService from "../../services/guild.service.js";
import * as channelService from "../../services/channel.service.js";
import * as memberService from "../../services/member.service.js";
import * as roleService from "../../services/role.service.js";
import * as inviteService from "../../services/invite.service.js";
import * as webhookService from "../../services/webhook.service.js";
import * as emojiService from "../../services/emoji.service.js";
import * as threadService from "../../services/thread.service.js";
import * as auditlogService from "../../services/auditlog.service.js";
import * as permissionService from "../../services/permission.service.js";
import * as guildTemplateService from "../../services/guild-template.service.js";
import * as channelFollowService from "../../services/channel-follow.service.js";
import { ApiError, getUserById } from "../../services/auth.service.js";
import { ChannelType, AuditLogActionType } from "@yxc/types";
import { PermissionFlags } from "@yxc/permissions";
import { redisPub } from "../../config/redis.js";
import { db, schema } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

// Helper to dispatch gateway events to a guild
async function dispatchGuild(guildId: string, event: string, data: unknown) {
  await redisPub.publish(
    `gateway:guild:${guildId}`,
    JSON.stringify({ event, data })
  );
}

export async function guildRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ── Guild CRUD ──

  app.post("/guilds", async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(2).max(100),
        icon: z.string().optional(),
      })
      .parse(request.body);

    const guild = await guildService.createGuild(request.userId, body.name, body.icon);
    await dispatchGuild(guild!.id, "GUILD_CREATE", guild);
    return reply.status(201).send(guild);
  });

  app.get("/guilds/:guildId", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    if (!(await guildService.isMember(request.userId, guildId))) {
      throw new ApiError(403, "Not a member of this guild");
    }
    const guild = await guildService.getGuild(guildId);
    if (!guild) throw new ApiError(404, "Guild not found");
    return reply.send(guild);
  });

  app.patch("/guilds/:guildId", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        name: z.string().min(2).max(100).optional(),
        icon: z.string().optional(),
        banner: z.string().optional(),
        description: z.string().max(1000).optional(),
        verificationLevel: z.number().int().min(0).max(4).optional(),
        defaultMessageNotifications: z.number().int().min(0).max(1).optional(),
        explicitContentFilter: z.number().int().min(0).max(2).optional(),
        systemChannelId: z.string().optional(),
        rulesChannelId: z.string().optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);

    const guild = await guildService.updateGuild(guildId, request.userId, body);
    await dispatchGuild(guildId, "GUILD_UPDATE", guild);
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.GUILD_UPDATE, guildId);
    return reply.send(guild);
  });

  app.delete("/guilds/:guildId", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await guildService.deleteGuild(guildId, request.userId);
    await dispatchGuild(guildId, "GUILD_DELETE", { id: guildId });
    return reply.status(204).send();
  });

  app.get("/users/@me/guilds", async (request, reply) => {
    const guilds = await guildService.getUserGuilds(request.userId);
    return reply.send(guilds);
  });

  // Leave guild
  app.delete("/users/@me/guilds/:guildId", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const user = await getUserById(request.userId);
    await memberService.removeMember(guildId, request.userId);
    await dispatchGuild(guildId, "GUILD_MEMBER_REMOVE", {
      guildId,
      user: user ? { id: user.id, username: user.username, avatar: user.avatar } : { id: request.userId },
    });
    return reply.status(204).send();
  });

  // ── Channels ──

  app.get("/guilds/:guildId/channels", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    if (!(await guildService.isMember(request.userId, guildId))) {
      throw new ApiError(403, "Not a member");
    }
    const channels = await channelService.getGuildChannels(guildId);
    return reply.send(channels);
  });

  app.post("/guilds/:guildId/channels", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        name: z.string().min(1).max(100),
        type: z.nativeEnum(ChannelType).default(ChannelType.GUILD_TEXT),
        topic: z.string().max(1024).optional(),
        parentId: z.string().optional(),
        nsfw: z.boolean().optional(),
        rateLimitPerUser: z.number().int().min(0).max(21600).optional(),
        bitrate: z.number().int().optional(),
        userLimit: z.number().int().min(0).max(99).optional(),
        position: z.number().int().optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_CHANNELS);

    const channel = await channelService.createChannel(guildId, body);
    await dispatchGuild(guildId, "CHANNEL_CREATE", channel);
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.CHANNEL_CREATE, channel.id);
    return reply.status(201).send(channel);
  });

  // ── Channel operations ──

  app.get("/channels/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const channel = await channelService.getChannel(channelId);
    if (!channel) throw new ApiError(404, "Channel not found");
    if (channel.guildId) {
      if (!(await guildService.isMember(request.userId, channel.guildId))) {
        throw new ApiError(403, "Not a member of this guild");
      }
    }
    return reply.send(channel);
  });

  app.patch("/channels/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        topic: z.string().max(1024).optional(),
        position: z.number().int().optional(),
        parentId: z.string().nullable().optional(),
        nsfw: z.boolean().optional(),
        rateLimitPerUser: z.number().int().min(0).max(21600).optional(),
        bitrate: z.number().int().optional(),
        userLimit: z.number().int().min(0).max(99).optional(),
      })
      .parse(request.body);

    const existingChannel = await channelService.getChannel(channelId);
    if (existingChannel?.guildId) {
      await permissionService.requireGuildPermission(request.userId, existingChannel.guildId, PermissionFlags.MANAGE_CHANNELS);
    }

    const channel = await channelService.updateChannel(channelId, body);
    if (channel.guildId) {
      await dispatchGuild(channel.guildId, "CHANNEL_UPDATE", channel);
      await auditlogService.createAuditLogEntry(channel.guildId, request.userId, AuditLogActionType.CHANNEL_UPDATE, channelId);
    }
    return reply.send(channel);
  });

  app.delete("/channels/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const channel = await channelService.getChannel(channelId);
    if (channel?.guildId) {
      await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_CHANNELS);
    }
    await channelService.deleteChannel(channelId);
    if (channel?.guildId) {
      await dispatchGuild(channel.guildId, "CHANNEL_DELETE", { id: channelId, guildId: channel.guildId });
      await auditlogService.createAuditLogEntry(channel.guildId, request.userId, AuditLogActionType.CHANNEL_DELETE, channelId);
    }
    return reply.status(204).send();
  });

  // ── Members ──

  app.get("/guilds/:guildId/members", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    if (!(await guildService.isMember(request.userId, guildId))) {
      throw new ApiError(403, "Not a member");
    }
    const members = await memberService.getGuildMembers(guildId);
    return reply.send(members);
  });

  app.delete("/guilds/:guildId/members/:userId", async (request, reply) => {
    const { guildId, userId } = request.params as { guildId: string; userId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.KICK_MEMBERS);
    const user = await getUserById(userId);
    await memberService.kickMember(guildId, userId, request.userId);
    await dispatchGuild(guildId, "GUILD_MEMBER_REMOVE", {
      guildId,
      user: user ? { id: user.id, username: user.username, avatar: user.avatar } : { id: userId },
    });
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.MEMBER_KICK, userId);
    return reply.status(204).send();
  });

  // ── Bans ──

  app.put("/guilds/:guildId/bans/:userId", async (request, reply) => {
    const { guildId, userId } = request.params as { guildId: string; userId: string };
    const body = z.object({ reason: z.string().optional() }).parse(request.body ?? {});
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.BAN_MEMBERS);
    const user = await getUserById(userId);
    await memberService.banMember(guildId, userId, request.userId, body.reason);
    await dispatchGuild(guildId, "GUILD_BAN_ADD", {
      guildId,
      user: user ? { id: user.id, username: user.username, avatar: user.avatar } : { id: userId },
    });
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.MEMBER_BAN_ADD, userId, body.reason);
    return reply.status(204).send();
  });

  app.delete("/guilds/:guildId/bans/:userId", async (request, reply) => {
    const { guildId, userId } = request.params as { guildId: string; userId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.BAN_MEMBERS);
    const user = await getUserById(userId);
    await memberService.unbanMember(guildId, userId);
    await dispatchGuild(guildId, "GUILD_BAN_REMOVE", {
      guildId,
      user: user ? { id: user.id, username: user.username, avatar: user.avatar } : { id: userId },
    });
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.MEMBER_BAN_REMOVE, userId);
    return reply.status(204).send();
  });

  app.get("/guilds/:guildId/bans", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.BAN_MEMBERS);
    const bans = await db.select().from(schema.bans).where(eq(schema.bans.guildId, guildId));
    if (bans.length === 0) return reply.send([]);

    const bannedUserIds = bans.map((b) => b.userId);
    const { inArray } = await import("drizzle-orm");
    const bannedUsers = await db
      .select({ id: schema.users.id, username: schema.users.username, avatar: schema.users.avatar })
      .from(schema.users)
      .where(inArray(schema.users.id, bannedUserIds));
    const userMap = new Map(bannedUsers.map((u) => [u.id, u]));

    const result = bans.map((ban) => {
      const user = userMap.get(ban.userId);
      return { reason: ban.reason, user: user ? { id: user.id, username: user.username, avatar: user.avatar } : null };
    });
    return reply.send(result);
  });

  // ── Roles ──

  app.get("/guilds/:guildId/roles", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const roles = await roleService.getGuildRoles(guildId);
    return reply.send(roles);
  });

  app.post("/guilds/:guildId/roles", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        name: z.string().max(100).optional(),
        color: z.number().int().optional(),
        hoist: z.boolean().optional(),
        permissions: z.string().optional(),
        mentionable: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_ROLES);

    const role = await roleService.createRole(guildId, body);
    await dispatchGuild(guildId, "GUILD_ROLE_CREATE", { guildId, role });
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.ROLE_CREATE, role.id);
    return reply.status(201).send(role);
  });

  app.patch("/guilds/:guildId/roles/:roleId", async (request, reply) => {
    const { guildId, roleId } = request.params as { guildId: string; roleId: string };
    const body = z
      .object({
        name: z.string().max(100).optional(),
        color: z.number().int().optional(),
        hoist: z.boolean().optional(),
        permissions: z.string().optional(),
        mentionable: z.boolean().optional(),
        position: z.number().int().optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_ROLES);

    const role = await roleService.updateRole(roleId, body);
    await dispatchGuild(guildId, "GUILD_ROLE_UPDATE", { guildId, role });
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.ROLE_UPDATE, roleId);
    return reply.send(role);
  });

  app.delete("/guilds/:guildId/roles/:roleId", async (request, reply) => {
    const { guildId, roleId } = request.params as { guildId: string; roleId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_ROLES);
    await roleService.deleteRole(roleId, guildId);
    await dispatchGuild(guildId, "GUILD_ROLE_DELETE", { guildId, roleId });
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.ROLE_DELETE, roleId);
    return reply.status(204).send();
  });

  // Add/remove role from member
  app.put(
    "/guilds/:guildId/members/:userId/roles/:roleId",
    async (request, reply) => {
      const { guildId, userId, roleId } = request.params as {
        guildId: string;
        userId: string;
        roleId: string;
      };
      await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_ROLES);
      await roleService.addRoleToMember(guildId, userId, roleId);
      const roles = await roleService.getMemberRoles(guildId, userId);
      await dispatchGuild(guildId, "GUILD_MEMBER_UPDATE", { guildId, userId, roles });
      await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.MEMBER_ROLE_UPDATE, userId);
      return reply.status(204).send();
    }
  );

  app.delete(
    "/guilds/:guildId/members/:userId/roles/:roleId",
    async (request, reply) => {
      const { guildId, userId, roleId } = request.params as {
        guildId: string;
        userId: string;
        roleId: string;
      };
      await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_ROLES);
      await roleService.removeRoleFromMember(guildId, userId, roleId);
      const roles = await roleService.getMemberRoles(guildId, userId);
      await dispatchGuild(guildId, "GUILD_MEMBER_UPDATE", { guildId, userId, roles });
      await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.MEMBER_ROLE_UPDATE, userId);
      return reply.status(204).send();
    }
  );

  // ── Invites ──

  app.post("/channels/:channelId/invites", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        maxAge: z.number().int().min(0).max(604800).optional(),
        maxUses: z.number().int().min(0).max(100).optional(),
        temporary: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) throw new ApiError(404, "Channel not found");

    await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.CREATE_INSTANT_INVITE);

    const invite = await inviteService.createInvite(
      channel.guildId,
      channelId,
      request.userId,
      body
    );
    await dispatchGuild(channel.guildId, "INVITE_CREATE", {
      channelId,
      guildId: channel.guildId,
      code: invite.code,
      maxAge: invite.maxAge,
      maxUses: invite.maxUses,
      temporary: invite.temporary,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    });
    await auditlogService.createAuditLogEntry(channel.guildId, request.userId, AuditLogActionType.INVITE_CREATE, invite.code);
    return reply.status(201).send(invite);
  });

  app.get("/invites/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const invite = await inviteService.getInvite(code);
    return reply.send(invite);
  });

  app.post("/invites/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const result = await inviteService.useInvite(code, request.userId);
    if (!result.alreadyMember) {
      const user = await getUserById(request.userId);
      await dispatchGuild(result.guildId, "GUILD_MEMBER_ADD", {
        guildId: result.guildId,
        user: user ? { id: user.id, username: user.username, avatar: user.avatar } : { id: request.userId },
      });
    }
    return reply.send(result);
  });

  app.get("/guilds/:guildId/invites", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);
    const invites = await inviteService.getGuildInvites(guildId);
    return reply.send(invites);
  });

  app.delete("/invites/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const invite = await inviteService.getInvite(code);
    await permissionService.requireGuildPermission(request.userId, invite.guildId, PermissionFlags.MANAGE_GUILD);
    await inviteService.deleteInvite(code);
    await dispatchGuild(invite.guildId, "INVITE_DELETE", {
      channelId: invite.channelId,
      guildId: invite.guildId,
      code,
    });
    await auditlogService.createAuditLogEntry(invite.guildId, request.userId, AuditLogActionType.INVITE_DELETE, code);
    return reply.status(204).send();
  });

  // ── Webhooks ──

  app.get("/channels/:channelId/webhooks", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const channel = await channelService.getChannel(channelId);
    if (channel?.guildId) {
      await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_WEBHOOKS);
    }
    const webhooks = await webhookService.getChannelWebhooks(channelId);
    return reply.send(webhooks);
  });

  app.get("/guilds/:guildId/webhooks", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_WEBHOOKS);
    const webhooks = await webhookService.getGuildWebhooks(guildId);
    return reply.send(webhooks);
  });

  app.post("/channels/:channelId/webhooks", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        name: z.string().min(1).max(80),
        avatar: z.string().optional(),
      })
      .parse(request.body);

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) throw new ApiError(404, "Channel not found");

    await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_WEBHOOKS);

    const webhook = await webhookService.createWebhook(
      channel.guildId,
      channelId,
      request.userId,
      body.name,
      body.avatar
    );
    await dispatchGuild(channel.guildId, "WEBHOOKS_UPDATE", { guildId: channel.guildId, channelId });
    await auditlogService.createAuditLogEntry(channel.guildId, request.userId, AuditLogActionType.WEBHOOK_CREATE, webhook.id);
    return reply.status(201).send(webhook);
  });

  app.get("/webhooks/:webhookId", async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };
    const webhook = await webhookService.getWebhook(webhookId);
    return reply.send(webhook);
  });

  app.patch("/webhooks/:webhookId", async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        avatar: z.string().nullable().optional(),
        channelId: z.string().optional(),
      })
      .parse(request.body);

    const existingWebhook = await webhookService.getWebhook(webhookId);
    await permissionService.requireGuildPermission(request.userId, existingWebhook.guildId, PermissionFlags.MANAGE_WEBHOOKS);

    const webhook = await webhookService.updateWebhook(webhookId, body);
    await dispatchGuild(existingWebhook.guildId, "WEBHOOKS_UPDATE", { guildId: existingWebhook.guildId, channelId: webhook.channelId });
    await auditlogService.createAuditLogEntry(existingWebhook.guildId, request.userId, AuditLogActionType.WEBHOOK_UPDATE, webhookId);
    return reply.send(webhook);
  });

  app.delete("/webhooks/:webhookId", async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };
    const webhook = await webhookService.getWebhook(webhookId);
    await permissionService.requireGuildPermission(request.userId, webhook.guildId, PermissionFlags.MANAGE_WEBHOOKS);
    await webhookService.deleteWebhook(webhookId);
    await dispatchGuild(webhook.guildId, "WEBHOOKS_UPDATE", { guildId: webhook.guildId, channelId: webhook.channelId });
    await auditlogService.createAuditLogEntry(webhook.guildId, request.userId, AuditLogActionType.WEBHOOK_DELETE, webhookId);
    return reply.status(204).send();
  });

  // NOTE: Webhook execution is in webhookExec.ts (separate scope, no auth)

  // ── Emojis ──

  app.get("/guilds/:guildId/emojis", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const emojis = await emojiService.getGuildEmojis(guildId);
    return reply.send(emojis);
  });

  app.get("/guilds/:guildId/emojis/:emojiId", async (request, reply) => {
    const { emojiId } = request.params as { emojiId: string };
    const emoji = await emojiService.getEmoji(emojiId);
    return reply.send(emoji);
  });

  app.post("/guilds/:guildId/emojis", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        name: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/),
        animated: z.boolean().optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_EMOJIS_AND_STICKERS);

    const emoji = await emojiService.createEmoji(guildId, body.name, request.userId, body.animated);
    await dispatchGuild(guildId, "GUILD_EMOJIS_UPDATE", {
      guildId,
      emojis: await emojiService.getGuildEmojis(guildId),
    });
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.EMOJI_CREATE, emoji.id);
    return reply.status(201).send(emoji);
  });

  app.patch("/guilds/:guildId/emojis/:emojiId", async (request, reply) => {
    const { guildId, emojiId } = request.params as { guildId: string; emojiId: string };
    const body = z.object({ name: z.string().min(2).max(32) }).parse(request.body);
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_EMOJIS_AND_STICKERS);
    const emoji = await emojiService.updateEmoji(emojiId, body.name);
    await dispatchGuild(guildId, "GUILD_EMOJIS_UPDATE", {
      guildId,
      emojis: await emojiService.getGuildEmojis(guildId),
    });
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.EMOJI_UPDATE, emojiId);
    return reply.send(emoji);
  });

  app.delete("/guilds/:guildId/emojis/:emojiId", async (request, reply) => {
    const { guildId, emojiId } = request.params as { guildId: string; emojiId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_EMOJIS_AND_STICKERS);
    await emojiService.deleteEmoji(emojiId);
    await dispatchGuild(guildId, "GUILD_EMOJIS_UPDATE", {
      guildId,
      emojis: await emojiService.getGuildEmojis(guildId),
    });
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.EMOJI_DELETE, emojiId);
    return reply.status(204).send();
  });

  // ── Threads ──

  app.post("/channels/:channelId/threads", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        name: z.string().min(1).max(100),
        type: z.number().int().optional(),
        autoArchiveDuration: z.number().int().optional(),
      })
      .parse(request.body);

    const parentChannel = await channelService.getChannel(channelId);
    if (parentChannel?.guildId) {
      await permissionService.requireGuildPermission(request.userId, parentChannel.guildId, PermissionFlags.SEND_MESSAGES);
    }

    const thread = await threadService.createThread(channelId, body.name, request.userId, {
      type: body.type,
      autoArchiveDuration: body.autoArchiveDuration,
    });

    if (thread?.guildId) {
      await dispatchGuild(thread.guildId, "THREAD_CREATE", thread);
      await auditlogService.createAuditLogEntry(thread.guildId, request.userId, AuditLogActionType.THREAD_CREATE, thread.id);
    }

    return reply.status(201).send(thread);
  });

  app.patch("/channels/:threadId/thread", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        archived: z.boolean().optional(),
        autoArchiveDuration: z.number().int().optional(),
        locked: z.boolean().optional(),
        invitable: z.boolean().optional(),
      })
      .parse(request.body);

    const existingThread = await threadService.getThread(threadId);
    if (existingThread?.guildId) {
      await permissionService.requireGuildPermission(request.userId, existingThread.guildId, PermissionFlags.MANAGE_THREADS);
    }

    const thread = await threadService.updateThread(threadId, body);
    if (thread?.guildId) {
      await dispatchGuild(thread.guildId, "THREAD_UPDATE", thread);
      await auditlogService.createAuditLogEntry(thread.guildId, request.userId, AuditLogActionType.THREAD_UPDATE, threadId);
    }
    return reply.send(thread);
  });

  app.delete("/channels/:threadId/thread", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const thread = await threadService.getThread(threadId);
    if (thread?.guildId) {
      await permissionService.requireGuildPermission(request.userId, thread.guildId, PermissionFlags.MANAGE_THREADS);
    }
    await threadService.deleteThread(threadId);
    if (thread?.guildId) {
      await dispatchGuild(thread.guildId, "THREAD_DELETE", { id: threadId, guildId: thread.guildId, parentId: thread.parentId });
      await auditlogService.createAuditLogEntry(thread.guildId, request.userId, AuditLogActionType.THREAD_DELETE, threadId);
    }
    return reply.status(204).send();
  });

  app.get("/channels/:threadId/thread-members", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const members = await threadService.getThreadMembers(threadId);
    return reply.send(members);
  });

  app.put("/channels/:threadId/thread-members/@me", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    await threadService.addThreadMember(threadId, request.userId);
    return reply.status(204).send();
  });

  app.delete("/channels/:threadId/thread-members/@me", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    await threadService.removeThreadMember(threadId, request.userId);
    return reply.status(204).send();
  });

  app.put("/channels/:threadId/thread-members/:userId", async (request, reply) => {
    const { threadId, userId } = request.params as { threadId: string; userId: string };
    const thread = await threadService.getThread(threadId);
    if (thread?.guildId) {
      await permissionService.requireGuildPermission(request.userId, thread.guildId, PermissionFlags.MANAGE_THREADS);
    }
    await threadService.addThreadMember(threadId, userId);
    return reply.status(204).send();
  });

  app.delete("/channels/:threadId/thread-members/:userId", async (request, reply) => {
    const { threadId, userId } = request.params as { threadId: string; userId: string };
    const thread = await threadService.getThread(threadId);
    if (thread?.guildId) {
      await permissionService.requireGuildPermission(request.userId, thread.guildId, PermissionFlags.MANAGE_THREADS);
    }
    await threadService.removeThreadMember(threadId, userId);
    return reply.status(204).send();
  });

  app.get("/guilds/:guildId/threads/active", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const threads = await threadService.getActiveThreads(guildId);
    return reply.send({ threads, hasMore: false });
  });

  // ── Audit Log ──

  app.get("/guilds/:guildId/audit-logs", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.VIEW_AUDIT_LOG);
    const query = z
      .object({
        userId: z.string().optional(),
        actionType: z.coerce.number().int().optional(),
        before: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);

    const entries = await auditlogService.getAuditLog(guildId, query);
    return reply.send({ auditLogEntries: entries });
  });

  // ── Permission Overwrites ──

  app.put("/channels/:channelId/permissions/:overwriteId", async (request, reply) => {
    const { channelId, overwriteId } = request.params as { channelId: string; overwriteId: string };
    const body = z
      .object({
        type: z.union([z.literal(0), z.literal(1)]),
        allow: z.string().default("0"),
        deny: z.string().default("0"),
      })
      .parse(request.body);

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) throw new ApiError(404, "Channel not found");

    await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_ROLES);

    const overwrite = await permissionService.setPermissionOverwrite(
      channelId,
      overwriteId,
      body.type,
      body.allow,
      body.deny
    );

    await dispatchGuild(channel.guildId, "CHANNEL_UPDATE", await channelService.getChannel(channelId));
    await auditlogService.createAuditLogEntry(
      channel.guildId,
      request.userId,
      AuditLogActionType.CHANNEL_OVERWRITE_UPDATE,
      channelId
    );
    return reply.status(204).send();
  });

  app.delete("/channels/:channelId/permissions/:overwriteId", async (request, reply) => {
    const { channelId, overwriteId } = request.params as { channelId: string; overwriteId: string };

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) throw new ApiError(404, "Channel not found");

    await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_ROLES);
    await permissionService.deletePermissionOverwrite(channelId, overwriteId);

    await dispatchGuild(channel.guildId, "CHANNEL_UPDATE", await channelService.getChannel(channelId));
    await auditlogService.createAuditLogEntry(
      channel.guildId,
      request.userId,
      AuditLogActionType.CHANNEL_OVERWRITE_DELETE,
      channelId
    );
    return reply.status(204).send();
  });

  // ── Channel Following (Announcements) ──

  // Follow an announcement channel
  app.post("/channels/:channelId/followers", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        webhook_channel_id: z.string(),
      })
      .parse(request.body);

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) throw new ApiError(404, "Channel not found");

    // Verify user has MANAGE_WEBHOOKS in target channel
    const targetChannel = await channelService.getChannel(body.webhook_channel_id);
    if (!targetChannel || !targetChannel.guildId) throw new ApiError(404, "Target channel not found");

    await permissionService.requireGuildPermission(request.userId, targetChannel.guildId, PermissionFlags.MANAGE_WEBHOOKS);

    const follower = await channelFollowService.followChannel(
      channelId,
      body.webhook_channel_id,
      request.userId
    );

    return reply.status(200).send({
      channel_id: channelId,
      webhook_id: follower.webhookId,
    });
  });

  // Get channel followers
  app.get("/channels/:channelId/followers", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) throw new ApiError(404, "Channel not found");

    await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.MANAGE_WEBHOOKS);

    const followers = await channelFollowService.getChannelFollowers(channelId);
    return reply.send(followers);
  });

  // Crosspost a message
  app.post("/channels/:channelId/messages/:messageId/crosspost", async (request, reply) => {
    const { channelId, messageId } = request.params as { channelId: string; messageId: string };

    const channel = await channelService.getChannel(channelId);
    if (!channel || !channel.guildId) throw new ApiError(404, "Channel not found");
    if (channel.type !== 5) throw new ApiError(400, "Can only crosspost in announcement channels");

    await permissionService.requireGuildPermission(request.userId, channel.guildId, PermissionFlags.SEND_MESSAGES);

    // Get the message
    const [message] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!message) throw new ApiError(404, "Message not found");

    // Get author info
    const [author] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, message.authorId))
      .limit(1);

    // Crosspost to all followers
    const successCount = await channelFollowService.crosspostMessage(
      channelId,
      messageId,
      message.content,
      author?.username ?? "Unknown",
      author?.avatar ? `/avatars/${author.id}/${author.avatar}` : undefined
    );

    // Mark message as crossposted (set flag)
    await db
      .update(schema.messages)
      .set({ flags: (message.flags ?? 0) | 1 }) // Flag 1 = CROSSPOSTED
      .where(eq(schema.messages.id, messageId));

    return reply.send({ ...message, flags: (message.flags ?? 0) | 1 });
  });

  // ── Member Nicknames ──

  app.patch("/guilds/:guildId/members/:userId", async (request, reply) => {
    const { guildId, userId } = request.params as { guildId: string; userId: string };
    const body = z
      .object({
        nick: z.string().max(32).nullable().optional(),
        mute: z.boolean().optional(),
        deaf: z.boolean().optional(),
        communication_disabled_until: z.string().datetime().nullable().optional(),
        roles: z.array(z.string()).optional(),
      })
      .parse(request.body);

    // Permission checks based on what's being modified
    if (body.nick !== undefined) {
      if (userId !== request.userId) {
        await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_NICKNAMES);
      } else {
        await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.CHANGE_NICKNAME);
      }
    }

    if (body.mute !== undefined || body.deaf !== undefined) {
      await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MUTE_MEMBERS);
    }

    if (body.communication_disabled_until !== undefined) {
      await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MODERATE_MEMBERS);
      // Validate timeout duration (max 28 days)
      if (body.communication_disabled_until) {
        const timeout = new Date(body.communication_disabled_until);
        const maxTimeout = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
        if (timeout > maxTimeout) {
          throw new ApiError(400, "Timeout duration cannot exceed 28 days");
        }
      }
    }

    if (body.roles !== undefined) {
      await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_ROLES);
      // Update member roles
      for (const roleId of body.roles) {
        await roleService.addRoleToMember(guildId, userId, roleId);
      }
    }

    // Build update object
    const updateData: Record<string, unknown> = {};
    if (body.nick !== undefined) updateData.nickname = body.nick;
    if (body.mute !== undefined) updateData.mute = body.mute;
    if (body.deaf !== undefined) updateData.deaf = body.deaf;
    if (body.communication_disabled_until !== undefined) {
      updateData.communicationDisabledUntil = body.communication_disabled_until
        ? new Date(body.communication_disabled_until)
        : null;
    }

    if (Object.keys(updateData).length > 0) {
      await db
        .update(schema.members)
        .set(updateData)
        .where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)));
    }

    const roles = await roleService.getMemberRoles(guildId, userId);
    const member = await db
      .select()
      .from(schema.members)
      .where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)))
      .then(r => r[0]);

    const memberUpdate = {
      guildId,
      userId,
      nick: member?.nickname ?? null,
      roles,
      mute: member?.mute ?? false,
      deaf: member?.deaf ?? false,
      communication_disabled_until: member?.communicationDisabledUntil?.toISOString() ?? null,
    };

    await dispatchGuild(guildId, "GUILD_MEMBER_UPDATE", memberUpdate);
    await auditlogService.createAuditLogEntry(guildId, request.userId, AuditLogActionType.MEMBER_UPDATE, userId);
    return reply.send(memberUpdate);
  });

  app.patch("/guilds/:guildId/members/@me", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        nick: z.string().max(32).nullable().optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.CHANGE_NICKNAME);

    await db
      .update(schema.members)
      .set({ nickname: body.nick ?? null })
      .where(and(eq(schema.members.userId, request.userId), eq(schema.members.guildId, guildId)));

    const roles = await roleService.getMemberRoles(guildId, request.userId);
    await dispatchGuild(guildId, "GUILD_MEMBER_UPDATE", {
      guildId,
      userId: request.userId,
      nick: body.nick ?? null,
      roles,
    });
    return reply.send({ guildId, userId: request.userId, nick: body.nick ?? null });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GUILD TEMPLATES
  // ══════════════════════════════════════════════════════════════════════════════

  // Get template by code
  app.get("/guilds/templates/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const template = await guildTemplateService.getTemplate(code);
    if (!template) throw new ApiError(404, "Template not found");
    return reply.send(template);
  });

  // Create guild from template
  app.post("/guilds/templates/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const body = z
      .object({
        name: z.string().min(2).max(100),
        icon: z.string().optional(),
      })
      .parse(request.body);

    const result = await guildTemplateService.createGuildFromTemplate(
      code,
      body.name,
      request.userId,
      body.icon
    );

    const guild = await guildService.getGuild(result.guildId);
    return reply.status(201).send(guild);
  });

  // Get guild's template
  app.get("/guilds/:guildId/templates", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);

    const template = await guildTemplateService.getGuildTemplate(guildId);
    return reply.send(template ? [template] : []);
  });

  // Create guild template
  app.post("/guilds/:guildId/templates", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        name: z.string().min(1).max(100),
        description: z.string().max(120).optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);

    const template = await guildTemplateService.createTemplate(
      guildId,
      body.name,
      body.description ?? null,
      request.userId
    );

    return reply.status(201).send(template);
  });

  // Sync template with source guild
  app.put("/guilds/:guildId/templates/:code", async (request, reply) => {
    const { guildId, code } = request.params as { guildId: string; code: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);

    const template = await guildTemplateService.getTemplate(code);
    if (!template || template.guildId !== guildId) {
      throw new ApiError(404, "Template not found");
    }

    const updated = await guildTemplateService.syncTemplate(code);
    return reply.send(updated);
  });

  // Update template metadata
  app.patch("/guilds/:guildId/templates/:code", async (request, reply) => {
    const { guildId, code } = request.params as { guildId: string; code: string };
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(120).nullable().optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);

    const template = await guildTemplateService.getTemplate(code);
    if (!template || template.guildId !== guildId) {
      throw new ApiError(404, "Template not found");
    }

    const updated = await guildTemplateService.updateTemplate(code, body);
    return reply.send(updated);
  });

  // Delete template
  app.delete("/guilds/:guildId/templates/:code", async (request, reply) => {
    const { guildId, code } = request.params as { guildId: string; code: string };
    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);

    const template = await guildTemplateService.getTemplate(code);
    if (!template || template.guildId !== guildId) {
      throw new ApiError(404, "Template not found");
    }

    await guildTemplateService.deleteTemplate(code);
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GUILD WIDGETS
  // ══════════════════════════════════════════════════════════════════════════════

  // Get guild widget settings
  app.get("/guilds/:guildId/widget", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    const [widget] = await db
      .select()
      .from(schema.guildWidgets)
      .where(eq(schema.guildWidgets.guildId, guildId))
      .limit(1);

    return reply.send({
      enabled: widget?.enabled ?? false,
      channelId: widget?.channelId ?? null,
    });
  });

  // Update guild widget settings
  app.patch("/guilds/:guildId/widget", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        enabled: z.boolean().optional(),
        channelId: z.string().nullable().optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);

    // Upsert widget settings
    const existing = await db
      .select()
      .from(schema.guildWidgets)
      .where(eq(schema.guildWidgets.guildId, guildId))
      .then((r) => r[0]);

    if (existing) {
      await db
        .update(schema.guildWidgets)
        .set({
          enabled: body.enabled ?? existing.enabled,
          channelId: body.channelId !== undefined ? body.channelId : existing.channelId,
        })
        .where(eq(schema.guildWidgets.guildId, guildId));
    } else {
      await db.insert(schema.guildWidgets).values({
        guildId,
        enabled: body.enabled ?? false,
        channelId: body.channelId ?? null,
      });
    }

    const [updated] = await db
      .select()
      .from(schema.guildWidgets)
      .where(eq(schema.guildWidgets.guildId, guildId))
      .limit(1);

    return reply.send(updated);
  });

  // Get guild widget JSON (public)
  app.get("/guilds/:guildId/widget.json", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    const [widget] = await db
      .select()
      .from(schema.guildWidgets)
      .where(eq(schema.guildWidgets.guildId, guildId))
      .limit(1);

    if (!widget?.enabled) {
      throw new ApiError(403, "Widget disabled");
    }

    const guild = await guildService.getGuild(guildId);
    if (!guild) throw new ApiError(404, "Guild not found");

    const members = await memberService.getGuildMembers(guildId);
    const channels = await channelService.getGuildChannels(guildId);
    const voiceStates: any[] = [];

    // Get online members count
    const presenceCount = members.filter((m) => m.user?.status !== "offline").length;

    return reply.send({
      id: guild.id,
      name: guild.name,
      instant_invite: null, // Would need to generate/fetch an invite
      channels: channels
        .filter((c) => c.type === ChannelType.GUILD_VOICE)
        .map((c) => ({
          id: c.id,
          name: c.name,
          position: c.position,
        })),
      members: voiceStates.map((vs) => ({
        id: vs.sessionId, // Use session ID for anonymity
        username: "Member",
        status: "online",
        channel_id: vs.channelId,
        avatar_url: null,
        deaf: vs.deaf || vs.selfDeaf,
        mute: vs.mute || vs.selfMute,
        suppress: vs.suppress,
      })),
      presence_count: presenceCount,
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GUILD WELCOME SCREEN
  // ══════════════════════════════════════════════════════════════════════════════

  // Get welcome screen
  app.get("/guilds/:guildId/welcome-screen", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    const [screen] = await db
      .select()
      .from(schema.guildWelcomeScreens)
      .where(eq(schema.guildWelcomeScreens.guildId, guildId))
      .limit(1);

    if (!screen) {
      return reply.send({
        description: null,
        welcome_channels: [],
      });
    }

    return reply.send({
      description: screen.description,
      welcome_channels: screen.welcomeChannels,
    });
  });

  // Update welcome screen
  app.patch("/guilds/:guildId/welcome-screen", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        enabled: z.boolean().optional(),
        description: z.string().max(140).nullable().optional(),
        welcome_channels: z
          .array(
            z.object({
              channelId: z.string(),
              description: z.string().max(50),
              emojiId: z.string().optional(),
              emojiName: z.string().optional(),
            })
          )
          .max(5)
          .optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);

    const existing = await db
      .select()
      .from(schema.guildWelcomeScreens)
      .where(eq(schema.guildWelcomeScreens.guildId, guildId))
      .then((r) => r[0]);

    if (existing) {
      await db
        .update(schema.guildWelcomeScreens)
        .set({
          enabled: body.enabled ?? existing.enabled,
          description: body.description !== undefined ? body.description : existing.description,
          welcomeChannels: body.welcome_channels ?? existing.welcomeChannels,
          updatedAt: new Date(),
        })
        .where(eq(schema.guildWelcomeScreens.guildId, guildId));
    } else {
      await db.insert(schema.guildWelcomeScreens).values({
        guildId,
        enabled: body.enabled ?? false,
        description: body.description ?? null,
        welcomeChannels: body.welcome_channels ?? [],
      });
    }

    const [updated] = await db
      .select()
      .from(schema.guildWelcomeScreens)
      .where(eq(schema.guildWelcomeScreens.guildId, guildId))
      .limit(1);

    return reply.send({
      description: updated?.description ?? null,
      welcome_channels: updated?.welcomeChannels ?? [],
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GUILD ONBOARDING
  // ══════════════════════════════════════════════════════════════════════════════

  // Get guild onboarding
  app.get("/guilds/:guildId/onboarding", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    const [onboarding] = await db
      .select()
      .from(schema.guildOnboarding)
      .where(eq(schema.guildOnboarding.guildId, guildId))
      .limit(1);

    return reply.send({
      guild_id: guildId,
      prompts: onboarding?.prompts ?? [],
      default_channel_ids: onboarding?.defaultChannelIds ?? [],
      enabled: onboarding?.enabled ?? false,
      mode: onboarding?.mode ?? 0,
    });
  });

  // Update guild onboarding
  app.put("/guilds/:guildId/onboarding", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        prompts: z.array(z.any()).optional(),
        default_channel_ids: z.array(z.string()).optional(),
        enabled: z.boolean().optional(),
        mode: z.number().int().min(0).max(1).optional(),
      })
      .parse(request.body);

    await permissionService.requireGuildPermission(request.userId, guildId, PermissionFlags.MANAGE_GUILD);

    const existing = await db
      .select()
      .from(schema.guildOnboarding)
      .where(eq(schema.guildOnboarding.guildId, guildId))
      .then((r) => r[0]);

    if (existing) {
      await db
        .update(schema.guildOnboarding)
        .set({
          prompts: body.prompts ?? existing.prompts,
          defaultChannelIds: body.default_channel_ids ?? existing.defaultChannelIds,
          enabled: body.enabled ?? existing.enabled,
          mode: body.mode ?? existing.mode,
          updatedAt: new Date(),
        })
        .where(eq(schema.guildOnboarding.guildId, guildId));
    } else {
      await db.insert(schema.guildOnboarding).values({
        guildId,
        prompts: body.prompts ?? [],
        defaultChannelIds: body.default_channel_ids ?? [],
        enabled: body.enabled ?? false,
        mode: body.mode ?? 0,
      });
    }

    const [updated] = await db
      .select()
      .from(schema.guildOnboarding)
      .where(eq(schema.guildOnboarding.guildId, guildId))
      .limit(1);

    return reply.send({
      guild_id: guildId,
      prompts: updated?.prompts ?? [],
      default_channel_ids: updated?.defaultChannelIds ?? [],
      enabled: updated?.enabled ?? false,
      mode: updated?.mode ?? 0,
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GUILD PREVIEW
  // ══════════════════════════════════════════════════════════════════════════════

  // Get guild preview (public for discoverable guilds)
  app.get("/guilds/:guildId/preview", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    const guild = await guildService.getGuild(guildId);
    if (!guild) throw new ApiError(404, "Guild not found");

    const [preview] = await db
      .select()
      .from(schema.guildPreviews)
      .where(eq(schema.guildPreviews.guildId, guildId))
      .limit(1);

    // Check if user is member or guild is discoverable
    const isMember = await guildService.isMember(request.userId, guildId);
    if (!isMember && !preview?.discoverable) {
      throw new ApiError(403, "Cannot preview this guild");
    }

    const members = await memberService.getGuildMembers(guildId);
    const emojis = await emojiService.getGuildEmojis(guildId);

    return reply.send({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      splash: guild.splash,
      banner: guild.banner,
      description: guild.description,
      features: guild.features,
      verification_level: guild.verificationLevel,
      approximate_member_count: preview?.approximateMemberCount ?? members.length,
      approximate_presence_count: preview?.approximatePresenceCount ?? members.filter((m) => m.user?.status !== "offline").length,
      emojis: emojis.map((e) => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
      })),
    });
  });
}
