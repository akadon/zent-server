import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";
import { ApiError } from "../../services/auth.service.js";
import * as eventService from "../../services/event.service.js";
import { memberRepository } from "../../repositories/member.repository.js";
import { eventRepository } from "../../repositories/event.repository.js";

async function requireMembership(userId: string, guildId: string) {
  const member = await memberRepository.findByUserAndGuild(userId, guildId);
  if (!member) {
    throw new ApiError(403, "You are not a member of this guild");
  }
  return member;
}

const createEventSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  channelId: z.string().optional(),
  scheduledStartTime: z.string().datetime().transform((s) => new Date(s)),
  scheduledEndTime: z.string().datetime().transform((s) => new Date(s)).optional(),
  privacyLevel: z.number().int().min(1).max(2).optional(),
  entityType: z.number().int().min(1).max(3),
  entityMetadata: z.object({
    location: z.string().max(200).optional(),
  }).optional(),
  image: z.string().optional(),
});

const updateEventSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  channelId: z.string().nullable().optional(),
  scheduledStartTime: z.string().datetime().transform((s) => new Date(s)).optional(),
  scheduledEndTime: z.string().datetime().transform((s) => new Date(s)).nullable().optional(),
  privacyLevel: z.number().int().min(1).max(2).optional(),
  status: z.number().int().min(1).max(4).optional(),
  entityType: z.number().int().min(1).max(3).optional(),
  entityMetadata: z.object({
    location: z.string().max(200).optional(),
  }).nullable().optional(),
  image: z.string().nullable().optional(),
});

function serializeEvent(event: eventService.GuildEvent) {
  return {
    id: event.id,
    guildId: event.guildId,
    channelId: event.channelId,
    creatorId: event.creatorId,
    name: event.name,
    description: event.description,
    scheduledStartTime: event.scheduledStartTime.toISOString(),
    scheduledEndTime: event.scheduledEndTime?.toISOString() ?? null,
    privacyLevel: event.privacyLevel,
    status: event.status,
    entityType: event.entityType,
    entityMetadata: event.entityMetadata,
    image: event.image,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function eventRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // Create event
  app.post(
    "/guilds/:guildId/scheduled-events",
    { preHandler: [createRateLimiter("channelEdit")] },
    async (request, reply) => {
      const { guildId } = request.params as { guildId: string };
      await requireMembership(request.userId, guildId);

      const body = createEventSchema.parse(request.body);

      const event = await eventService.createEvent(guildId, request.userId, body);

      // Auto-subscribe creator
      await eventService.addEventUser(guildId, event.id, request.userId);

      return reply.status(201).send(serializeEvent(event));
    }
  );

  // List events
  app.get("/guilds/:guildId/scheduled-events", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await requireMembership(request.userId, guildId);

    const { with_user_count } = request.query as { with_user_count?: string };
    const { after } = request.query as { after?: string };

    const events = await eventService.getGuildEvents(guildId, {
      after: after ? new Date(after) : undefined,
    });

    const serialized = events.map(serializeEvent);

    return reply.send(serialized);
  });

  // Get single event
  app.get("/guilds/:guildId/scheduled-events/:eventId", async (request, reply) => {
    const { guildId, eventId } = request.params as {
      guildId: string;
      eventId: string;
    };
    await requireMembership(request.userId, guildId);

    const event = await eventService.getEvent(eventId);
    if (!event || event.guildId !== guildId) {
      throw new ApiError(404, "Event not found");
    }

    return reply.send(serializeEvent(event));
  });

  // Update event
  app.patch(
    "/guilds/:guildId/scheduled-events/:eventId",
    { preHandler: [createRateLimiter("channelEdit")] },
    async (request, reply) => {
      const { guildId, eventId } = request.params as {
        guildId: string;
        eventId: string;
      };
      await requireMembership(request.userId, guildId);

      const body = updateEventSchema.parse(request.body);

      const event = await eventService.updateEvent(
        eventId,
        guildId,
        request.userId,
        body
      );

      return reply.send(serializeEvent(event));
    }
  );

  // Delete event
  app.delete(
    "/guilds/:guildId/scheduled-events/:eventId",
    async (request, reply) => {
      const { guildId, eventId } = request.params as {
        guildId: string;
        eventId: string;
      };
      await requireMembership(request.userId, guildId);

      await eventService.deleteEvent(eventId, guildId, request.userId);

      return reply.status(204).send();
    }
  );

  // Get event users
  app.get(
    "/guilds/:guildId/scheduled-events/:eventId/users",
    async (request, reply) => {
      const { guildId, eventId } = request.params as {
        guildId: string;
        eventId: string;
      };
      await requireMembership(request.userId, guildId);

      const event = await eventService.getEvent(eventId);
      if (!event || event.guildId !== guildId) {
        throw new ApiError(404, "Event not found");
      }

      const userIds = await eventService.getEventUsers(eventId);

      return reply.send(userIds.map((userId) => ({ user: { id: userId } })));
    }
  );

  // Add interest (subscribe)
  app.put(
    "/guilds/:guildId/scheduled-events/:eventId/users/@me",
    { preHandler: [createRateLimiter("reaction")] },
    async (request, reply) => {
      const { guildId, eventId } = request.params as {
        guildId: string;
        eventId: string;
      };
      await requireMembership(request.userId, guildId);

      await eventService.addEventUser(guildId, eventId, request.userId);

      return reply.status(204).send();
    }
  );

  // Remove interest (unsubscribe)
  app.delete(
    "/guilds/:guildId/scheduled-events/:eventId/users/@me",
    { preHandler: [createRateLimiter("reaction")] },
    async (request, reply) => {
      const { guildId, eventId } = request.params as {
        guildId: string;
        eventId: string;
      };
      await requireMembership(request.userId, guildId);

      await eventService.removeEventUser(guildId, eventId, request.userId);

      return reply.status(204).send();
    }
  );

  // Legacy routes for backward compatibility
  app.post(
    "/guilds/:guildId/events",
    { preHandler: [createRateLimiter("channelEdit")] },
    async (request, reply) => {
      const { guildId } = request.params as { guildId: string };
      await requireMembership(request.userId, guildId);

      const legacySchema = z.object({
        title: z.string().min(1).max(100),
        description: z.string().max(1000).default(""),
        channelId: z.string().optional(),
        startTime: z.string().datetime(),
        endTime: z.string().datetime().optional(),
        location: z.string().max(200).optional(),
      });

      const body = legacySchema.parse(request.body);

      const event = await eventService.createEvent(guildId, request.userId, {
        name: body.title,
        description: body.description,
        channelId: body.channelId,
        scheduledStartTime: new Date(body.startTime),
        scheduledEndTime: body.endTime ? new Date(body.endTime) : undefined,
        entityType: body.location
          ? eventService.GuildScheduledEventEntityType.EXTERNAL
          : eventService.GuildScheduledEventEntityType.VOICE,
        entityMetadata: body.location ? { location: body.location } : undefined,
      });

      await eventService.addEventUser(guildId, event.id, request.userId);

      // Return in legacy format
      return reply.status(201).send({
        id: event.id,
        guildId: event.guildId,
        channelId: event.channelId,
        title: event.name,
        description: event.description,
        startTime: event.scheduledStartTime.toISOString(),
        endTime: event.scheduledEndTime?.toISOString(),
        location: event.entityMetadata?.location,
        creatorId: event.creatorId,
        interested: [request.userId],
      });
    }
  );

  app.get("/guilds/:guildId/events", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    await requireMembership(request.userId, guildId);

    const { after } = request.query as { after?: string };

    const events = await eventService.getGuildEvents(guildId, {
      after: after ? new Date(after) : undefined,
    });

    // Batch fetch interested users for all events
    const eventIds = events.map((e) => e.id);
    let interestedByEvent = new Map<string, string[]>();
    if (eventIds.length > 0) {
      const allInterested = await eventRepository.findUsersByEventIds(eventIds);
      for (const row of allInterested) {
        const list = interestedByEvent.get(row.eventId) ?? [];
        list.push(row.userId);
        interestedByEvent.set(row.eventId, list);
      }
    }

    // Return in legacy format
    return reply.send(
      events.map((e) => ({
        id: e.id,
        guildId: e.guildId,
        channelId: e.channelId,
        title: e.name,
        description: e.description,
        startTime: e.scheduledStartTime.toISOString(),
        endTime: e.scheduledEndTime?.toISOString(),
        location: e.entityMetadata?.location,
        creatorId: e.creatorId,
        interested: interestedByEvent.get(e.id) ?? [],
      }))
    );
  });

  app.post(
    "/guilds/:guildId/events/:eventId/interest",
    { preHandler: [createRateLimiter("reaction")] },
    async (request, reply) => {
      const { guildId, eventId } = request.params as {
        guildId: string;
        eventId: string;
      };
      await requireMembership(request.userId, guildId);

      const event = await eventService.getEvent(eventId);
      if (!event || event.guildId !== guildId) {
        throw new ApiError(404, "Event not found");
      }

      const isInterested = await eventService.isEventUser(eventId, request.userId);

      if (isInterested) {
        await eventService.removeEventUser(guildId, eventId, request.userId);
      } else {
        await eventService.addEventUser(guildId, eventId, request.userId);
      }

      const count = await eventService.getEventUserCount(eventId);

      return reply.send({
        interested: !isInterested,
        count,
      });
    }
  );
}
