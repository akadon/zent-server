import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken, getUserById, ApiError } from "../services/auth.service.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header) {
    throw new ApiError(401, "Missing authorization header");
  }

  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!token) {
    throw new ApiError(401, "Missing token");
  }

  try {
    const payload = verifyToken(token);
    const user = await getUserById(payload.userId);
    if (!user) {
      throw new ApiError(401, "User not found");
    }
    request.userId = payload.userId;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, "Invalid token");
  }
}
