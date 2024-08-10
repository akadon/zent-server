import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { register, login, getUserById, ApiError } from "../../services/auth.service.js";
import { authMiddleware } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rateLimit.js";

const registerSchema = z.object({
  email: z.string().email().max(254),
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", { preHandler: [createRateLimiter("auth")] }, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await register(body.email, body.username, body.password);
    return reply.status(201).send(result);
  });

  app.post("/auth/login", { preHandler: [createRateLimiter("auth")] }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await login(body.email, body.password);
    return reply.send(result);
  });

  app.get(
    "/users/@me",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const user = await getUserById(request.userId);
      if (!user) throw new ApiError(404, "User not found");
      return reply.send({
        ...user,
        createdAt: user.createdAt.toISOString(),
      });
    }
  );

  app.patch(
    "/users/@me",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const updateSchema = z.object({
        username: z.string().min(2).max(32).optional(),
        displayName: z.string().max(32).nullable().optional(),
        avatar: z.string().nullable().optional(),
        banner: z.string().nullable().optional(),
        bio: z.string().max(190).nullable().optional(),
      });

      const body = updateSchema.parse(request.body);

      const { eq } = await import("drizzle-orm");
      const { db, schema } = await import("../../db/index.js");

      if (body.username) {
        const existing = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.username, body.username))
          .limit(1);
        if (existing.length > 0 && existing[0]!.id !== request.userId) {
          throw new ApiError(409, "Username taken");
        }
      }

      const [updated] = await db
        .update(schema.users)
        .set({
          ...body,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, request.userId))
        .returning({
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
          email: schema.users.email,
          avatar: schema.users.avatar,
          banner: schema.users.banner,
          bio: schema.users.bio,
          status: schema.users.status,
          customStatus: schema.users.customStatus,
          mfaEnabled: schema.users.mfaEnabled,
          verified: schema.users.verified,
          flags: schema.users.flags,
          premiumType: schema.users.premiumType,
          locale: schema.users.locale,
          createdAt: schema.users.createdAt,
        });

      return reply.send({
        ...updated!,
        createdAt: updated!.createdAt.toISOString(),
      });
    }
  );
}
