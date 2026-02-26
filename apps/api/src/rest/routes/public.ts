import type { FastifyInstance } from "fastify";
import { ApiError } from "../../services/auth.service.js";
import { channelRepository } from "../../repositories/channel.repository.js";
import { guildRepository } from "../../repositories/guild.repository.js";
import { messageRepository } from "../../repositories/message.repository.js";

// In-memory set of public channel IDs. Resets on server restart — not persisted to DB.
const publicChannelIds = new Set<string>();

// In-memory set of discoverable guild IDs. Resets on server restart — not persisted to DB.
const discoverableGuildIds = new Set<string>();

/** Register a channel as publicly viewable */
export function markChannelPublic(channelId: string) {
  publicChannelIds.add(channelId);
}

/** Register a guild as discoverable */
export function markGuildDiscoverable(guildId: string) {
  discoverableGuildIds.add(guildId);
}

export async function publicRoutes(app: FastifyInstance) {
  // Public channel view - no auth required
  app.get("/public/channels/:channelId", async (request, reply) => {
    const { channelId } = request.params as { channelId: string };

    if (!publicChannelIds.has(channelId)) {
      throw new ApiError(404, "Channel not found or not public");
    }

    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      throw new ApiError(404, "Channel not found");
    }

    const recentMessages = await messageRepository.findByChannelId(channelId, { limit: 50 });

    let guild = null;
    if (channel.guildId) {
      const g = await guildRepository.findById(channel.guildId);
      guild = g
        ? {
            id: g.id,
            name: g.name,
            icon: g.icon,
            description: g.description,
          }
        : null;
    }

    return reply.send({
      channel: {
        id: channel.id,
        name: channel.name,
        topic: channel.topic,
        type: channel.type,
        guildId: channel.guildId,
      },
      guild,
      messages: recentMessages.reverse().map((m) => ({
        id: m.id,
        content: m.content,
        authorId: m.authorId,
        createdAt: m.createdAt.toISOString(),
        editedTimestamp: m.editedTimestamp?.toISOString() ?? null,
      })),
    });
  });

  // Public guild info - no auth required
  app.get("/public/guilds/:guildId", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };

    if (!discoverableGuildIds.has(guildId)) {
      throw new ApiError(404, "Guild not found or not discoverable");
    }

    const guild = await guildRepository.findById(guildId);
    if (!guild) {
      throw new ApiError(404, "Guild not found");
    }

    const memberCount = await guildRepository.getMemberCount(guildId);

    return reply.send({
      id: guild.id,
      name: guild.name,
      description: guild.description,
      icon: guild.icon,
      banner: guild.banner,
      memberCount,
      features: guild.features,
    });
  });
}
