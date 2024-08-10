import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import * as applicationService from "../../services/application.service.js";
import { ApiError } from "../../services/auth.service.js";

const commandSchema = z.object({
  name: z.string().min(1).max(32).regex(/^[\w-]+$/).transform(s => s.toLowerCase()),
  description: z.string().min(1).max(100),
  type: z.number().int().min(1).max(3).optional(),
  options: z.array(z.any()).optional(),
  defaultMemberPermissions: z.string().optional(),
  dmPermission: z.boolean().optional(),
  nsfw: z.boolean().optional(),
});

export async function applicationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // ── Applications ──

  // Create application
  app.post("/applications", async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(100),
      })
      .parse(request.body);

    const application = await applicationService.createApplication(
      request.userId,
      body.name
    );
    return reply.status(201).send(application);
  });

  // Get user's applications
  app.get("/applications", async (request, reply) => {
    const applications = await applicationService.getUserApplications(request.userId);
    return reply.send(applications);
  });

  // Get application
  app.get("/applications/:applicationId", async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    const application = await applicationService.getApplication(applicationId);
    if (!application) {
      throw new ApiError(404, "Application not found");
    }
    if (application.ownerId !== request.userId) {
      throw new ApiError(403, "You don't own this application");
    }
    return reply.send(application);
  });

  // Update application
  app.patch("/applications/:applicationId", async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(400).optional(),
        icon: z.string().nullable().optional(),
        botPublic: z.boolean().optional(),
        botRequireCodeGrant: z.boolean().optional(),
        interactionsEndpointUrl: z.string().url().nullable().optional(),
      })
      .parse(request.body);

    const application = await applicationService.updateApplication(
      applicationId,
      request.userId,
      body
    );
    return reply.send(application);
  });

  // Delete application
  app.delete("/applications/:applicationId", async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    await applicationService.deleteApplication(applicationId, request.userId);
    return reply.status(204).send();
  });

  // ── Global Commands ──

  // Get global commands
  app.get("/applications/:applicationId/commands", async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }
    const commands = await applicationService.getGlobalCommands(applicationId);
    return reply.send(commands);
  });

  // Create global command
  app.post("/applications/:applicationId/commands", async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    const body = commandSchema.parse(request.body);

    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }

    const command = await applicationService.createCommand(applicationId, null, body);
    return reply.status(201).send(command);
  });

  // Get global command
  app.get("/applications/:applicationId/commands/:commandId", async (request, reply) => {
    const { applicationId, commandId } = request.params as { applicationId: string; commandId: string };
    const command = await applicationService.getCommand(applicationId, commandId);
    if (!command) {
      throw new ApiError(404, "Command not found");
    }
    return reply.send(command);
  });

  // Update global command
  app.patch("/applications/:applicationId/commands/:commandId", async (request, reply) => {
    const { applicationId, commandId } = request.params as { applicationId: string; commandId: string };
    const body = commandSchema.partial().parse(request.body);

    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }

    const command = await applicationService.updateCommand(applicationId, commandId, body);
    return reply.send(command);
  });

  // Delete global command
  app.delete("/applications/:applicationId/commands/:commandId", async (request, reply) => {
    const { applicationId, commandId } = request.params as { applicationId: string; commandId: string };

    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }

    await applicationService.deleteCommand(applicationId, commandId);
    return reply.status(204).send();
  });

  // Bulk overwrite global commands
  app.put("/applications/:applicationId/commands", async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };
    const body = z.array(commandSchema).parse(request.body);

    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }

    const commands = await applicationService.bulkOverwriteGlobalCommands(applicationId, body);
    return reply.send(commands);
  });

  // ── Guild Commands ──

  // Get guild commands
  app.get("/applications/:applicationId/guilds/:guildId/commands", async (request, reply) => {
    const { applicationId, guildId } = request.params as { applicationId: string; guildId: string };
    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }
    const commands = await applicationService.getGuildCommands(applicationId, guildId);
    return reply.send(commands);
  });

  // Create guild command
  app.post("/applications/:applicationId/guilds/:guildId/commands", async (request, reply) => {
    const { applicationId, guildId } = request.params as { applicationId: string; guildId: string };
    const body = commandSchema.parse(request.body);

    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }

    const command = await applicationService.createCommand(applicationId, guildId, body);
    return reply.status(201).send(command);
  });

  // Get guild command
  app.get("/applications/:applicationId/guilds/:guildId/commands/:commandId", async (request, reply) => {
    const { applicationId, commandId } = request.params as { applicationId: string; commandId: string };
    const command = await applicationService.getCommand(applicationId, commandId);
    if (!command) {
      throw new ApiError(404, "Command not found");
    }
    return reply.send(command);
  });

  // Update guild command
  app.patch("/applications/:applicationId/guilds/:guildId/commands/:commandId", async (request, reply) => {
    const { applicationId, commandId } = request.params as { applicationId: string; commandId: string };
    const body = commandSchema.partial().parse(request.body);

    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }

    const command = await applicationService.updateCommand(applicationId, commandId, body);
    return reply.send(command);
  });

  // Delete guild command
  app.delete("/applications/:applicationId/guilds/:guildId/commands/:commandId", async (request, reply) => {
    const { applicationId, commandId } = request.params as { applicationId: string; commandId: string };

    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }

    await applicationService.deleteCommand(applicationId, commandId);
    return reply.status(204).send();
  });

  // Bulk overwrite guild commands
  app.put("/applications/:applicationId/guilds/:guildId/commands", async (request, reply) => {
    const { applicationId, guildId } = request.params as { applicationId: string; guildId: string };
    const body = z.array(commandSchema).parse(request.body);

    const application = await applicationService.getApplication(applicationId);
    if (!application || application.ownerId !== request.userId) {
      throw new ApiError(403, "Not authorized");
    }

    const commands = await applicationService.bulkOverwriteGuildCommands(applicationId, guildId, body);
    return reply.send(commands);
  });
}
