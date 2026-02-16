import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as interactionService from "../../services/interaction.service.js";
import * as applicationService from "../../services/application.service.js";
import { ApiError } from "../../services/auth.service.js";
import crypto from "crypto";

// Ed25519 signature verification for Discord-style webhook
async function verifySignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  try {
    const message = Buffer.from(timestamp + body);
    const sig = Buffer.from(signature, "hex");
    const key = Buffer.from(publicKey, "hex");

    // Create a proper KeyObject from the raw key bytes
    const keyObj = crypto.createPublicKey({
      key: Buffer.concat([
        // Ed25519 public key DER prefix
        Buffer.from("302a300506032b6570032100", "hex"),
        key,
      ]),
      format: "der",
      type: "spki",
    });

    return crypto.verify(null, message, keyObj, sig);
  } catch {
    return false;
  }
}

export async function interactionRoutes(app: FastifyInstance) {
  // ── Interaction Webhook Endpoint (No Auth) ──
  // This endpoint receives interactions from Discord-compatible clients
  app.post("/interactions", {
    config: { rawBody: true },
  }, async (request, reply) => {
    const signature = request.headers["x-signature-ed25519"] as string;
    const timestamp = request.headers["x-signature-timestamp"] as string;

    if (!signature || !timestamp) {
      throw new ApiError(401, "Missing signature headers");
    }

    const rawBody = JSON.stringify(request.body);
    const body = z
      .object({
        id: z.string().optional(),
        application_id: z.string(),
        type: z.number().int(),
        guild_id: z.string().optional(),
        channel_id: z.string().optional(),
        member: z.object({ user: z.object({ id: z.string() }) }).optional(),
        user: z.object({ id: z.string() }).optional(),
        data: z.any().optional(),
        token: z.string().optional(),
        version: z.number().int().optional(),
      })
      .parse(request.body);

    // Get application to verify signature
    const application = await applicationService.getApplication(body.application_id);
    if (!application) {
      throw new ApiError(404, "Application not found");
    }

    // Verify signature
    const isValid = await verifySignature(
      application.verifyKey,
      signature,
      timestamp,
      rawBody
    );

    if (!isValid) {
      throw new ApiError(401, "Invalid signature");
    }

    // Validate timestamp freshness (must be within 5 minutes)
    const timestampMs = Number(timestamp) * 1000;
    const now = Date.now();
    if (isNaN(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) {
      throw new ApiError(401, "Invalid request timestamp");
    }

    // Handle PING
    if (body.type === interactionService.InteractionType.PING) {
      return reply.send(interactionService.createPongResponse());
    }

    // Get user ID
    const userId = body.member?.user.id ?? body.user?.id;
    if (!userId) {
      throw new ApiError(400, "Could not determine user");
    }

    // Create interaction record
    const interaction = await interactionService.createInteraction(
      body.application_id,
      body.type,
      userId,
      {
        guildId: body.guild_id,
        channelId: body.channel_id,
        data: body.data,
      }
    );

    // For APPLICATION_COMMAND, resolve the command
    if (body.type === interactionService.InteractionType.APPLICATION_COMMAND && body.data?.name) {
      const command = await interactionService.resolveCommand(
        body.application_id,
        body.guild_id ?? null,
        body.data.name
      );

      if (!command) {
        return reply.send(
          interactionService.createMessageResponse({
            content: "Unknown command",
            flags: 64, // Ephemeral
          })
        );
      }

      // In a full implementation, this would:
      // 1. Send the interaction to the bot's webhook endpoint
      // 2. Wait for a response
      // 3. Return the response to the user

      // For now, return a placeholder response
      return reply.send(
        interactionService.createDeferredResponse()
      );
    }

    // Default response for other interaction types
    return reply.send(
      interactionService.createDeferredResponse()
    );
  });

  // ── Interaction Response Callback (No Auth - uses token) ──
  // POST /interactions/:interactionId/:interactionToken/callback
  app.post("/interactions/:interactionId/:interactionToken/callback", async (request, reply) => {
    const { interactionId, interactionToken } = request.params as {
      interactionId: string;
      interactionToken: string;
    };
    const body = z
      .object({
        type: z.number().int().min(1).max(9),
        data: z.object({
          tts: z.boolean().optional(),
          content: z.string().optional(),
          embeds: z.array(z.any()).max(10).optional(),
          allowed_mentions: z.any().optional(),
          flags: z.number().int().optional(),
          components: z.array(z.any()).max(5).optional(),
          attachments: z.array(z.any()).optional(),
          choices: z.array(z.object({
            name: z.string(),
            value: z.union([z.string(), z.number()]),
          })).max(25).optional(),
          title: z.string().max(45).optional(),
          custom_id: z.string().max(100).optional(),
        }).optional(),
      })
      .parse(request.body);

    // Verify interaction exists and token matches
    const interaction = await interactionService.getInteractionByToken(interactionToken);
    if (!interaction || interaction.id !== interactionId) {
      throw new ApiError(404, "Unknown interaction");
    }

    // Check if already responded
    if (interaction.respondedAt) {
      throw new ApiError(400, "Interaction has already been responded to");
    }

    // Handle callback based on type
    const result = await interactionService.respondToInteraction(
      interactionId,
      interactionToken,
      body.type,
      body.data
    );

    return reply.status(result ? 200 : 204).send(result ?? undefined);
  });

  // ── Interaction Followup Routes (Authenticated) ──
  const authRoutes: FastifyInstance = app;
  authRoutes.register(async (authenticatedApp) => {
    authenticatedApp.addHook("preHandler", authMiddleware);

    // Get original interaction response
    app.get("/interactions/:applicationId/:interactionToken/messages/@original", async (request, reply) => {
      const { applicationId, interactionToken } = request.params as {
        applicationId: string;
        interactionToken: string;
      };

      const interaction = await interactionService.getInteractionByToken(interactionToken);
      if (!interaction || interaction.applicationId !== applicationId) {
        throw new ApiError(404, "Unknown interaction");
      }

      // Return the original response data
      return reply.send({
        id: interaction.id,
        applicationId,
        // In a full implementation, this would return the actual message
      });
    });

    // Edit original interaction response
    app.patch("/interactions/:applicationId/:interactionToken/messages/@original", async (request, reply) => {
      const { applicationId, interactionToken } = request.params as {
        applicationId: string;
        interactionToken: string;
      };
      const body = z
        .object({
          content: z.string().optional(),
          embeds: z.array(z.any()).optional(),
          components: z.array(z.any()).optional(),
        })
        .parse(request.body);

      const result = await interactionService.editOriginalResponse(
        applicationId,
        interactionToken,
        body
      );

      return reply.send(result);
    });

    // Delete original interaction response
    app.delete("/interactions/:applicationId/:interactionToken/messages/@original", async (request, reply) => {
      const { applicationId, interactionToken } = request.params as {
        applicationId: string;
        interactionToken: string;
      };

      await interactionService.deleteOriginalResponse(applicationId, interactionToken);
      return reply.status(204).send();
    });

    // Create followup message
    app.post("/interactions/:applicationId/:interactionToken/followup", async (request, reply) => {
      const { applicationId, interactionToken } = request.params as {
        applicationId: string;
        interactionToken: string;
      };
      const body = z
        .object({
          content: z.string().optional(),
          embeds: z.array(z.any()).optional(),
          components: z.array(z.any()).optional(),
          flags: z.number().int().optional(),
          tts: z.boolean().optional(),
        })
        .parse(request.body);

      const result = await interactionService.sendFollowup(
        applicationId,
        interactionToken,
        body
      );

      return reply.status(201).send(result);
    });
  });
}
