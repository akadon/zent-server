import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { ApiError } from "../../services/auth.service.js";
import * as guildService from "../../services/guild.service.js";
import * as automodService from "../../services/automod.service.js";
import type { AutoModConfig } from "../../services/automod.service.js";

export async function automodRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // GET /api/guilds/:guildId/automod
  app.get("/guilds/:guildId/automod", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    if (!(await guildService.isMember(request.userId, guildId))) {
      throw new ApiError(403, "Not a member of this guild");
    }

    const config = await automodService.getConfig(guildId);
    return reply.send(config);
  });

  // PUT /api/guilds/:guildId/automod
  app.put("/guilds/:guildId/automod", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    // Check ownership (MANAGE_GUILD simplified to owner check, matching guild.service pattern)
    const guild = await guildService.getGuild(guildId);
    if (!guild) throw new ApiError(404, "Guild not found");
    if (guild.ownerId !== request.userId) {
      throw new ApiError(403, "Missing permissions (MANAGE_GUILD required)");
    }

    const body = z
      .object({
        enabled: z.boolean(),
        keywordFilters: z.object({
          enabled: z.boolean(),
          blockedWords: z.array(z.string().max(100)).max(1000),
          action: z.enum(["delete", "warn", "timeout"]),
        }),
        mentionSpam: z.object({
          enabled: z.boolean(),
          maxMentions: z.number().int().min(1).max(100),
          action: z.enum(["delete", "warn", "timeout"]),
        }),
        linkFilter: z.object({
          enabled: z.boolean(),
          blockAllLinks: z.boolean(),
          whitelist: z.array(z.string().max(200)).max(100),
          action: z.enum(["delete", "warn", "timeout"]),
        }),
        antiRaid: z.object({
          enabled: z.boolean(),
          joinRateLimit: z.number().int().min(1).max(1000),
          joinRateWindow: z.number().int().min(1).max(3600),
          action: z.enum(["lockdown", "kick", "notify"]),
        }),
      })
      .parse(request.body) as AutoModConfig;

    await automodService.setConfig(guildId, body);
    return reply.send(body);
  });
}
