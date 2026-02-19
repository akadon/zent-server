import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as scheduledMessageService from "../../services/scheduled-message.service.js";
import * as notificationService from "../../services/notification.service.js";
import * as backupService from "../../services/backup.service.js";
import * as banAppealService from "../../services/ban-appeal.service.js";
import { ApiError } from "../../services/auth.service.js";

export async function featureRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ── Scheduled Messages ──

  app.post("/channels/:channelId/scheduled-messages", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        content: z.string().min(1).max(4000),
        scheduledFor: z.string(), // ISO date string
      })
      .parse(request.body);

    const msg = await scheduledMessageService.createScheduledMessage(
      channelId,
      request.userId,
      body.content,
      new Date(body.scheduledFor)
    );
    return reply.status(201).send(msg);
  });

  app.get("/channels/:channelId/scheduled-messages", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const messages = await scheduledMessageService.getScheduledMessages(channelId, request.userId);
    return reply.send(messages);
  });

  app.delete("/channels/:channelId/scheduled-messages/:messageId", async (request, reply) => {
    const { messageId } = request.params as { messageId: string };
    await scheduledMessageService.deleteScheduledMessage(messageId, request.userId);
    return reply.status(204).send();
  });

  // ── Notifications ──

  app.get("/users/@me/notifications", async (request, reply) => {
    const query = z
      .object({
        type: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        before: z.string().optional(),
      })
      .parse(request.query);

    const notifications = await notificationService.getNotifications(request.userId, query);
    return reply.send(notifications);
  });

  app.post("/users/@me/notifications/:notificationId/read", async (request, reply) => {
    const { notificationId } = request.params as { notificationId: string };
    await notificationService.markNotificationRead(notificationId, request.userId);
    return reply.status(204).send();
  });

  app.post("/users/@me/notifications/read-all", async (request, reply) => {
    await notificationService.markAllNotificationsRead(request.userId);
    return reply.status(204).send();
  });

  app.delete("/users/@me/notifications", async (request, reply) => {
    await notificationService.clearNotifications(request.userId);
    return reply.status(204).send();
  });

  // ── Server Backups ──

  app.post("/guilds/:guildId/backups", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const backup = await backupService.createBackup(guildId, request.userId);
    return reply.status(201).send(backup);
  });

  app.get("/guilds/:guildId/backups", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const backups = await backupService.getBackups(guildId);
    return reply.send(backups);
  });

  app.get("/guilds/:guildId/backups/:backupId", async (request, reply) => {
    const { backupId } = request.params as { backupId: string };
    const backup = await backupService.getBackup(backupId);
    return reply.send(backup);
  });

  app.delete("/guilds/:guildId/backups/:backupId", async (request, reply) => {
    const { backupId } = request.params as { backupId: string };
    await backupService.deleteBackup(backupId, request.userId);
    return reply.status(204).send();
  });

  // ── Ban Appeals ──

  app.post("/guilds/:guildId/ban-appeals", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const body = z
      .object({
        reason: z.string().min(1).max(2000),
      })
      .parse(request.body);

    const appeal = await banAppealService.createBanAppeal(guildId, request.userId, body.reason);
    return reply.status(201).send(appeal);
  });

  app.get("/guilds/:guildId/ban-appeals", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const appeals = await banAppealService.getGuildAppeals(guildId);
    return reply.send(appeals);
  });

  app.post("/guilds/:guildId/ban-appeals/:appealId/resolve", async (request, reply) => {
    const { appealId } = request.params as { appealId: string };
    const body = z
      .object({
        status: z.enum(["accepted", "rejected"]),
        reason: z.string().max(2000).optional(),
      })
      .parse(request.body);

    const appeal = await banAppealService.resolveAppeal(
      appealId,
      request.userId,
      body.status,
      body.reason
    );
    return reply.send(appeal);
  });

  // ── Disappearing Messages (channel setting) ──

  app.patch("/channels/:channelId/retention", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        messageRetentionSeconds: z.number().int().min(0).nullable(), // 0/null = forever
      })
      .parse(request.body);

    const { eq } = await import("drizzle-orm");
    const { db, schema } = await import("../../db/index.js");

    await db
      .update(schema.channels)
      .set({ messageRetentionSeconds: body.messageRetentionSeconds || null })
      .where(eq(schema.channels.id, channelId));

    const channelService = await import("../../services/channel.service.js");
    const channel = await channelService.getChannel(channelId);

    return reply.send(channel);
  });

  // ── Thread Templates ──

  app.post("/channels/:channelId/thread-templates", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const body = z
      .object({
        name: z.string().min(1).max(100),
        content: z.string().min(1).max(4000),
        guildId: z.string(),
      })
      .parse(request.body);

    const threadTemplateService = await import("../../services/thread-template.service.js");
    const template = await threadTemplateService.createTemplate(
      channelId,
      body.guildId,
      body.name,
      body.content,
      request.userId
    );
    return reply.status(201).send(template);
  });

  app.get("/channels/:channelId/thread-templates", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };
    const threadTemplateService = await import("../../services/thread-template.service.js");
    const templates = await threadTemplateService.getTemplates(channelId);
    return reply.send(templates);
  });

  app.delete("/channels/:channelId/thread-templates/:templateId", async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const threadTemplateService = await import("../../services/thread-template.service.js");
    await threadTemplateService.deleteTemplate(templateId, request.userId);
    return reply.status(204).send();
  });

  // ── Notification Settings ──

  app.get("/users/@me/notification-settings", async (request, reply) => {
    const query = z
      .object({
        guildId: z.string().optional(),
        channelId: z.string().optional(),
      })
      .parse(request.query);

    const notifSettingsService = await import("../../services/notification-settings.service.js");
    const settings = await notifSettingsService.getSettings(
      request.userId,
      query.guildId,
      query.channelId
    );
    return reply.send(settings[0] ?? null);
  });

  app.put("/users/@me/notification-settings", async (request, reply) => {
    const body = z
      .object({
        guildId: z.string().nullable().optional(),
        channelId: z.string().nullable().optional(),
        level: z.enum(["all", "mentions", "none"]).optional(),
        suppressEveryone: z.boolean().optional(),
        suppressRoles: z.boolean().optional(),
        muted: z.boolean().optional(),
        muteUntil: z.string().nullable().optional(),
      })
      .parse(request.body);

    const notifSettingsService = await import("../../services/notification-settings.service.js");
    const settings = await notifSettingsService.upsertSettings(
      request.userId,
      body.guildId ?? null,
      body.channelId ?? null,
      body
    );
    return reply.send(settings);
  });

  // ── Data Export (GDPR) ──

  app.get("/users/@me/export", async (request, reply) => {
    const dataExportService = await import("../../services/data-export.service.js");
    const data = await dataExportService.exportUserData(request.userId);
    if (!data) throw new ApiError(404, "User not found");
    return reply.send(data);
  });

  app.get("/guilds/:guildId/export", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    const dataExportService = await import("../../services/data-export.service.js");
    const data = await dataExportService.exportGuildData(guildId, request.userId);
    if (!data) throw new ApiError(404, "Guild not found or not owner");
    return reply.send(data);
  });
}
