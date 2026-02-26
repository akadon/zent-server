import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { ApiError } from "../../services/auth.service.js";
import { dispatchUser } from "../../utils/dispatch.js";
import { sessionRepository } from "../../repositories/session.repository.js";

export async function sessionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // List all user sessions
  app.get("/users/@me/sessions", async (request, reply) => {
    const sessions = await sessionRepository.findByUserId(request.userId);

    return reply.send(
      sessions.map((s) => ({
        id: s.id,
        deviceInfo: s.deviceInfo,
        ipAddress: s.ipAddress ? maskIp(s.ipAddress) : null,
        lastActiveAt: s.lastActiveAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === (request as any).sessionId,
      }))
    );
  });

  // Get current session
  app.get("/users/@me/sessions/current", async (request, reply) => {
    const sessionId = (request as any).sessionId;
    if (!sessionId) {
      throw new ApiError(404, "Session not found");
    }

    const session = await sessionRepository.findByIdAndUserId(sessionId, request.userId);
    if (!session) {
      throw new ApiError(404, "Session not found");
    }

    return reply.send({
      id: session.id,
      deviceInfo: session.deviceInfo,
      ipAddress: session.ipAddress ? maskIp(session.ipAddress) : null,
      lastActiveAt: session.lastActiveAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: true,
    });
  });

  // Revoke a specific session
  app.delete("/users/@me/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const existing = await sessionRepository.findByIdAndUserId(sessionId, request.userId);
    if (!existing) {
      throw new ApiError(404, "Session not found");
    }

    await sessionRepository.deleteByIdAndUserId(sessionId, request.userId);

    // Immediately invalidate gateway session via Redis pub/sub
    await dispatchUser(request.userId, "SESSION_INVALIDATE", {});

    return reply.status(204).send();
  });

  // Revoke all sessions except current
  app.delete("/users/@me/sessions", async (request, reply) => {
    const body = z
      .object({
        exceptCurrent: z.boolean().default(true),
      })
      .parse(request.body ?? {});

    const currentSessionId = (request as any).sessionId;

    if (body.exceptCurrent && currentSessionId) {
      await sessionRepository.deleteByUserIdExcept(request.userId, currentSessionId);
    } else {
      await sessionRepository.deleteAllByUserId(request.userId);
    }

    // Immediately invalidate gateway sessions via Redis pub/sub
    await dispatchUser(request.userId, "SESSION_INVALIDATE", {
      exceptSocketId: body.exceptCurrent ? currentSessionId : null,
    });

    return reply.status(204).send();
  });
}

// Mask IP address for privacy (show only first parts)
function maskIp(ip: string): string {
  if (ip.includes(":")) {
    // IPv6
    const parts = ip.split(":");
    return parts.slice(0, 4).join(":") + ":****:****:****:****";
  } else {
    // IPv4
    const parts = ip.split(".");
    return parts.slice(0, 2).join(".") + ".***.*****";
  }
}
