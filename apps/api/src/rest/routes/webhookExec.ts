import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as webhookService from "../../services/webhook.service.js";
import * as channelService from "../../services/channel.service.js";
import { redisPub } from "../../config/redis.js";

/** Public webhook execution — no auth required, uses webhook token */
export async function publicWebhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/:webhookId/:token", async (request, reply) => {
    const { webhookId, token } = request.params as {
      webhookId: string;
      token: string;
    };
    const body = z
      .object({
        content: z.string().min(1).max(4000),
        username: z.string().max(80).optional(),
        avatar_url: z.string().optional(),
        tts: z.boolean().optional(),
      })
      .parse(request.body);

    const message = await webhookService.executeWebhook(webhookId, token, body.content, {
      username: body.username,
      avatarUrl: body.avatar_url,
      tts: body.tts,
    });

    const channel = await channelService.getChannel(message.channelId);
    if (channel?.guildId) {
      const payload = JSON.stringify({ event: "MESSAGE_CREATE", data: message });
      await redisPub.publish(`gateway:guild:${channel.guildId}`, payload);
    }

    return reply.status(200).send(message);
  });
}
