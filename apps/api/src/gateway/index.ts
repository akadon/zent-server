import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { env } from "../config/env.js";
import { config } from "../config/config.js";
import { redisPub, redisSub, redis } from "../config/redis.js";
import { verifyToken, getUserById } from "../services/auth.service.js";
import { getUserGuilds } from "../services/guild.service.js";
import { getReadStates } from "../services/readstate.service.js";
import { getRelationships, getUserDMChannels } from "../services/relationship.service.js";
import { GatewayOp } from "@yxc/gateway-types";
import type {
  GatewayPayload,
  IdentifyPayload,
  HelloPayload,
  ReadyPayload,
  PresenceUpdatePayload,
  RequestGuildMembersPayload,
  VoiceStateUpdatePayload,
} from "@yxc/gateway-types";
import { GatewayIntentBits } from "@yxc/gateway-types";
import crypto from "crypto";
import { memberRepository } from "../repositories/member.repository.js";
import { userRepository } from "../repositories/user.repository.js";

const HEARTBEAT_INTERVAL = 41250; // ~41s
const PRESENCE_TTL = 300; // 5 minutes
const SESSION_TTL = Math.ceil(HEARTBEAT_INTERVAL / 1000) + 30; // heartbeat interval + buffer
const RESUME_WINDOW = 300; // 5 minutes
const RESUME_BUFFER_MAX = 500;

interface GatewaySession {
  userId: string;
  sessionId: string;
  sequence: number;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  lastHeartbeat: number;
  guilds: string[];
  intents: number;
  rateLimits: Record<number, { count: number; windowStart: number }>;
}

// Per-opcode rate limits: [maxCount, windowMs]
const OPCODE_RATE_LIMITS: Record<number, [number, number]> = {
  [GatewayOp.IDENTIFY]: [1, 5000],
  [GatewayOp.HEARTBEAT]: [3, 41000],
  [GatewayOp.PRESENCE_UPDATE]: [5, 60000],
  [GatewayOp.VOICE_STATE_UPDATE]: [5, 10000],
  [GatewayOp.REQUEST_GUILD_MEMBERS]: [10, 120000],
};

function checkOpcodeRateLimit(session: GatewaySession, op: number): boolean {
  const limit = OPCODE_RATE_LIMITS[op];
  if (!limit) return true;
  const [maxCount, windowMs] = limit;
  const now = Date.now();
  const bucket = session.rateLimits[op];
  if (!bucket || now - bucket.windowStart > windowMs) {
    session.rateLimits[op] = { count: 1, windowStart: now };
    return true;
  }
  if (bucket.count >= maxCount) return false;
  bucket.count++;
  return true;
}

// Map events to required intents
const EVENT_INTENTS: Record<string, number> = {
  GUILD_CREATE: GatewayIntentBits.GUILDS,
  GUILD_UPDATE: GatewayIntentBits.GUILDS,
  GUILD_DELETE: GatewayIntentBits.GUILDS,
  GUILD_ROLE_CREATE: GatewayIntentBits.GUILDS,
  GUILD_ROLE_UPDATE: GatewayIntentBits.GUILDS,
  GUILD_ROLE_DELETE: GatewayIntentBits.GUILDS,
  CHANNEL_CREATE: GatewayIntentBits.GUILDS,
  CHANNEL_UPDATE: GatewayIntentBits.GUILDS,
  CHANNEL_DELETE: GatewayIntentBits.GUILDS,
  CHANNEL_PINS_UPDATE: GatewayIntentBits.GUILDS,
  THREAD_CREATE: GatewayIntentBits.GUILDS,
  THREAD_UPDATE: GatewayIntentBits.GUILDS,
  THREAD_DELETE: GatewayIntentBits.GUILDS,
  THREAD_LIST_SYNC: GatewayIntentBits.GUILDS,
  THREAD_MEMBER_UPDATE: GatewayIntentBits.GUILDS,
  THREAD_MEMBERS_UPDATE: GatewayIntentBits.GUILD_MEMBERS,
  STAGE_INSTANCE_CREATE: GatewayIntentBits.GUILDS,
  STAGE_INSTANCE_UPDATE: GatewayIntentBits.GUILDS,
  STAGE_INSTANCE_DELETE: GatewayIntentBits.GUILDS,
  GUILD_MEMBER_ADD: GatewayIntentBits.GUILD_MEMBERS,
  GUILD_MEMBER_UPDATE: GatewayIntentBits.GUILD_MEMBERS,
  GUILD_MEMBER_REMOVE: GatewayIntentBits.GUILD_MEMBERS,
  GUILD_AUDIT_LOG_ENTRY_CREATE: GatewayIntentBits.GUILD_MODERATION,
  GUILD_BAN_ADD: GatewayIntentBits.GUILD_MODERATION,
  GUILD_BAN_REMOVE: GatewayIntentBits.GUILD_MODERATION,
  GUILD_EMOJIS_UPDATE: GatewayIntentBits.GUILD_EMOJIS_AND_STICKERS,
  GUILD_STICKERS_UPDATE: GatewayIntentBits.GUILD_EMOJIS_AND_STICKERS,
  GUILD_INTEGRATIONS_UPDATE: GatewayIntentBits.GUILD_INTEGRATIONS,
  WEBHOOKS_UPDATE: GatewayIntentBits.GUILD_WEBHOOKS,
  INVITE_CREATE: GatewayIntentBits.GUILD_INVITES,
  INVITE_DELETE: GatewayIntentBits.GUILD_INVITES,
  VOICE_STATE_UPDATE: GatewayIntentBits.GUILD_VOICE_STATES,
  VOICE_CHANNEL_EFFECT_SEND: GatewayIntentBits.GUILD_VOICE_STATES,
  PRESENCE_UPDATE: GatewayIntentBits.GUILD_PRESENCES,
  MESSAGE_CREATE: GatewayIntentBits.GUILD_MESSAGES,
  MESSAGE_UPDATE: GatewayIntentBits.GUILD_MESSAGES,
  MESSAGE_DELETE: GatewayIntentBits.GUILD_MESSAGES,
  MESSAGE_DELETE_BULK: GatewayIntentBits.GUILD_MESSAGES,
  MESSAGE_REACTION_ADD: GatewayIntentBits.GUILD_MESSAGE_REACTIONS,
  MESSAGE_REACTION_REMOVE: GatewayIntentBits.GUILD_MESSAGE_REACTIONS,
  MESSAGE_REACTION_REMOVE_ALL: GatewayIntentBits.GUILD_MESSAGE_REACTIONS,
  MESSAGE_REACTION_REMOVE_EMOJI: GatewayIntentBits.GUILD_MESSAGE_REACTIONS,
  TYPING_START: GatewayIntentBits.GUILD_MESSAGE_TYPING,
  GUILD_SCHEDULED_EVENT_CREATE: GatewayIntentBits.GUILD_SCHEDULED_EVENTS,
  GUILD_SCHEDULED_EVENT_UPDATE: GatewayIntentBits.GUILD_SCHEDULED_EVENTS,
  GUILD_SCHEDULED_EVENT_DELETE: GatewayIntentBits.GUILD_SCHEDULED_EVENTS,
  GUILD_SCHEDULED_EVENT_USER_ADD: GatewayIntentBits.GUILD_SCHEDULED_EVENTS,
  GUILD_SCHEDULED_EVENT_USER_REMOVE: GatewayIntentBits.GUILD_SCHEDULED_EVENTS,
  AUTO_MODERATION_RULE_CREATE: GatewayIntentBits.AUTO_MODERATION_CONFIGURATION,
  AUTO_MODERATION_RULE_UPDATE: GatewayIntentBits.AUTO_MODERATION_CONFIGURATION,
  AUTO_MODERATION_RULE_DELETE: GatewayIntentBits.AUTO_MODERATION_CONFIGURATION,
  AUTO_MODERATION_ACTION_EXECUTION: GatewayIntentBits.AUTO_MODERATION_EXECUTION,
  GUILD_SOUNDBOARD_SOUND_CREATE: GatewayIntentBits.GUILD_EXPRESSIONS,
  GUILD_SOUNDBOARD_SOUND_UPDATE: GatewayIntentBits.GUILD_EXPRESSIONS,
  GUILD_SOUNDBOARD_SOUND_DELETE: GatewayIntentBits.GUILD_EXPRESSIONS,
  GUILD_SOUNDBOARD_SOUNDS_UPDATE: GatewayIntentBits.GUILD_EXPRESSIONS,
  MESSAGE_POLL_VOTE_ADD: GatewayIntentBits.GUILD_MESSAGE_POLLS,
  MESSAGE_POLL_VOTE_REMOVE: GatewayIntentBits.GUILD_MESSAGE_POLLS,
};

// Check if session has required intent for event
function hasIntent(session: GatewaySession, event: string): boolean {
  const requiredIntent = EVENT_INTENTS[event];
  if (!requiredIntent) return true;
  return (session.intents & requiredIntent) !== 0;
}

// ── Redis-backed session storage ──
// Local hot cache for sessions on this process (avoids Redis round-trip for every dispatch)
const localSessions = new Map<string, GatewaySession>();

async function storeSession(socketId: string, session: GatewaySession) {
  localSessions.set(socketId, session);
  const key = `session:${socketId}`;
  await redis.hset(key, {
    userId: session.userId,
    sessionId: session.sessionId,
    sequence: session.sequence.toString(),
    intents: session.intents.toString(),
    guilds: JSON.stringify(session.guilds),
  });
  await redis.expire(key, SESSION_TTL);
}

async function storeSessionIndex(sessionId: string, socketId: string, intents: number) {
  const key = `session_idx:${sessionId}`;
  await redis.hset(key, { socketId, intents: intents.toString() });
  await redis.expire(key, RESUME_WINDOW);
}

async function getSessionIndex(sessionId: string): Promise<{ socketId: string; intents: number } | null> {
  const data = await redis.hgetall(`session_idx:${sessionId}`);
  if (!data || !data.socketId) return null;
  return { socketId: data.socketId, intents: parseInt(data.intents ?? "0xFFFFFFFF", 10) };
}

async function removeSession(socketId: string) {
  localSessions.delete(socketId);
  await redis.del(`session:${socketId}`);
}

async function refreshSessionTTL(socketId: string) {
  await redis.expire(`session:${socketId}`, SESSION_TTL);
}

// ── Resume buffer in Redis ──

async function pushResumeEvent(sessionId: string, payload: GatewayPayload) {
  const key = `resume:${sessionId}`;
  await redis.rpush(key, JSON.stringify(payload));
  await redis.ltrim(key, -RESUME_BUFFER_MAX, -1);
  await redis.expire(key, RESUME_WINDOW);
}

async function getResumeEvents(sessionId: string, afterSeq: number): Promise<GatewayPayload[]> {
  const key = `resume:${sessionId}`;
  const all = await redis.lrange(key, 0, -1);
  return all
    .map((s) => JSON.parse(s) as GatewayPayload)
    .filter((p) => p.s !== undefined && p.s > afterSeq);
}

async function clearResumeBuffer(sessionId: string) {
  await redis.del(`resume:${sessionId}`);
}

// ── Batch presence fetch from Redis ──

async function fetchPresences(userIds: string[], guildId: string) {
  if (userIds.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const uid of userIds) {
    pipeline.hget(`presence:${uid}`, "status");
  }
  const results = await pipeline.exec();
  return userIds.map((uid, i) => ({
    userId: uid,
    guildId,
    status: (results?.[i]?.[1] as string) ?? "offline",
  }));
}

export function createGateway(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    path: "/gateway",
    cors: {
      origin: config.cors.origins,
      methods: ["GET", "POST"],
    },
    transports: ["websocket"],
    maxHttpBufferSize: 1e6,
    serveClient: false,
    pingInterval: 25000,
    pingTimeout: 20000,
    connectTimeout: 10000,
    perMessageDeflate: false,
  });

  // Redis adapter for horizontal scaling
  io.adapter(createAdapter(redisPub, redisSub));

  // Cleanup stale localSessions entries every 60s
  setInterval(() => {
    for (const socketId of localSessions.keys()) {
      if (!io.sockets.sockets.has(socketId)) {
        localSessions.delete(socketId);
      }
    }
  }, 60_000);

  // Subscribe to gateway events from API routes via Redis pub/sub
  const gatewaySub = new Redis(env.REDIS_URL);
  gatewaySub.psubscribe("gateway:guild:*", "gateway:user:*");
  gatewaySub.on("pmessage", async (_pattern, channel, message) => {
    try {
      const parsed = JSON.parse(message) as { event: string; data: unknown };
      const requiredIntent = EVENT_INTENTS[parsed.event];

      if (channel.startsWith("gateway:guild:")) {
        const guildId = channel.replace("gateway:guild:", "");
        const roomName = `guild:${guildId}`;
        const socketsInRoom = await io.in(roomName).fetchSockets();

        for (const remoteSocket of socketsInRoom) {
          const socketSession = localSessions.get(remoteSocket.id);
          if (!socketSession) continue;

          if (requiredIntent && (socketSession.intents & requiredIntent) === 0) {
            continue;
          }

          let eventData = parsed.data;
          if (parsed.event.startsWith("MESSAGE_") && parsed.data && typeof parsed.data === "object") {
            const messageData = parsed.data as Record<string, unknown>;
            if ((socketSession.intents & GatewayIntentBits.MESSAGE_CONTENT) === 0) {
              const mentions = (messageData.mentions as string[]) ?? [];
              const authorId = messageData.authorId as string;
              if (authorId !== socketSession.userId && !mentions.includes(socketSession.userId)) {
                eventData = {
                  ...messageData,
                  content: "",
                  embeds: [],
                  attachments: [],
                  components: [],
                };
              }
            }
          }

          const payload: GatewayPayload = {
            op: GatewayOp.DISPATCH,
            t: parsed.event as any,
            s: socketSession.sequence++,
            d: eventData,
          };
          remoteSocket.emit("message", payload);

          // Push to resume buffer
          pushResumeEvent(socketSession.sessionId, payload);
        }
      } else if (channel.startsWith("gateway:user:")) {
        const userId = channel.replace("gateway:user:", "");

        // Handle session invalidation: disconnect sockets immediately
        if (parsed.event === "SESSION_INVALIDATE") {
          const invalidateData = parsed.data as { exceptSocketId?: string | null };
          const socketsToDisconnect = await io.in(`user:${userId}`).fetchSockets();
          for (const remoteSocket of socketsToDisconnect) {
            const socketSession = localSessions.get(remoteSocket.id);
            if (invalidateData.exceptSocketId && socketSession?.sessionId === invalidateData.exceptSocketId) {
              continue;
            }
            if (socketSession) {
              if (socketSession.heartbeatTimer) clearTimeout(socketSession.heartbeatTimer);
              await removeSession(remoteSocket.id);
              await clearResumeBuffer(socketSession.sessionId);
            }
            remoteSocket.emit("message", { op: GatewayOp.INVALID_SESSION, d: false });
            remoteSocket.disconnect(true);
          }
          return;
        }

        const socketsInUserRoom = await io.in(`user:${userId}`).fetchSockets();
        for (const remoteSocket of socketsInUserRoom) {
          const socketSession = localSessions.get(remoteSocket.id);
          if (!socketSession) continue;
          const payload: GatewayPayload = {
            op: GatewayOp.DISPATCH,
            t: parsed.event as any,
            s: socketSession.sequence++,
            d: parsed.data,
          };
          remoteSocket.emit("message", payload);
          pushResumeEvent(socketSession.sessionId, payload);
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  io.on("connection", (socket) => {
    let session: GatewaySession | null = null;

    // Send HELLO
    const helloPayload: GatewayPayload = {
      op: GatewayOp.HELLO,
      d: { heartbeatInterval: HEARTBEAT_INTERVAL } satisfies HelloPayload,
    };
    socket.emit("message", helloPayload);

    socket.on("message", async (payload: GatewayPayload) => {
      try {
        // Per-opcode rate limiting
        if (session && !checkOpcodeRateLimit(session, payload.op)) {
          socket.emit("message", { op: GatewayOp.INVALID_SESSION, d: false });
          return;
        }

        switch (payload.op) {
          case GatewayOp.IDENTIFY:
            await handleIdentify(socket, payload.d as IdentifyPayload);
            break;

          case GatewayOp.HEARTBEAT:
            handleHeartbeat(socket);
            break;

          case GatewayOp.PRESENCE_UPDATE:
            if (session) {
              await handlePresenceUpdate(session, payload.d as PresenceUpdatePayload);
            }
            break;

          case GatewayOp.RESUME:
            await handleResume(socket, payload.d as { token: string; sessionId: string; seq: number });
            break;

          case GatewayOp.VOICE_STATE_UPDATE:
            if (session) {
              await handleVoiceStateUpdate(session, payload.d as VoiceStateUpdatePayload);
            }
            break;

          case GatewayOp.REQUEST_GUILD_MEMBERS:
            if (session) {
              await handleRequestGuildMembers(socket, session, payload.d as RequestGuildMembersPayload);
            }
            break;
        }
      } catch (err: any) {
        // Differentiate auth errors from internal errors
        if (err?.name === "TokenExpiredError" || err?.name === "JsonWebTokenError") {
          socket.emit("message", { op: GatewayOp.INVALID_SESSION, d: false });
        } else {
          console.error("Gateway error:", err);
          // Don't invalidate session on internal errors — just log
        }
      }
    });

    socket.on("disconnect", async () => {
      if (session) {
        if (session.heartbeatTimer) clearTimeout(session.heartbeatTimer);

        await setPresence(session.userId, "offline", null);

        // Pipeline all presence broadcasts instead of sequential awaits
        if (session.guilds.length > 0) {
          const pipeline = redisPub.pipeline();
          for (const guildId of session.guilds) {
            socket.leave(`guild:${guildId}`);
            pipeline.publish(
              `gateway:guild:${guildId}`,
              JSON.stringify({
                event: "PRESENCE_UPDATE",
                data: {
                  userId: session.userId,
                  guildId,
                  status: "offline",
                  customStatus: null,
                },
              })
            );
          }
          await pipeline.exec();
        }

        // Store session index in Redis for resume (TTL handles cleanup)
        await storeSessionIndex(session.sessionId, socket.id, session.intents);
        await removeSession(socket.id);
      }
    });

    async function handleIdentify(
      socket: ReturnType<typeof io.sockets.sockets.get> extends infer S ? NonNullable<S> : never,
      data: IdentifyPayload
    ) {
      const tokenPayload = verifyToken(data.token);
      const user = await getUserById(tokenPayload.userId);
      if (!user) {
        socket.emit("message", { op: GatewayOp.INVALID_SESSION, d: false });
        return;
      }

      const sessionId = crypto.randomUUID();
      const [userGuilds, readStates, relationships, dmChannels] = await Promise.all([
        getUserGuilds(user.id),
        getReadStates(user.id),
        getRelationships(user.id),
        getUserDMChannels(user.id),
      ]);

      session = {
        userId: user.id,
        sessionId,
        sequence: 0,
        heartbeatTimer: null,
        lastHeartbeat: Date.now(),
        guilds: userGuilds.map((g) => g.id),
        intents: data.intents ?? 0xFFFFFFFF,
        rateLimits: {},
      };

      // Store session in Redis + local cache
      await storeSession(socket.id, session);
      await storeSessionIndex(sessionId, socket.id, session.intents);

      // Join guild rooms
      for (const guild of userGuilds) {
        socket.join(`guild:${guild.id}`);
      }
      socket.join(`user:${user.id}`);

      // Set user online
      await setPresence(user.id, "online", null);

      // Pipeline all presence broadcasts
      if (userGuilds.length > 0) {
        const pipeline = redisPub.pipeline();
        for (const guild of userGuilds) {
          pipeline.publish(
            `gateway:guild:${guild.id}`,
            JSON.stringify({
              event: "PRESENCE_UPDATE",
              data: { userId: user.id, guildId: guild.id, status: "online", customStatus: null },
            })
          );
        }
        await pipeline.exec();
      }

      // Send READY
      const readyPayload: GatewayPayload = {
        op: GatewayOp.DISPATCH,
        t: "READY",
        s: ++session.sequence,
        d: {
          user: { ...user, createdAt: user.createdAt.toISOString() },
          guilds: userGuilds as any,
          sessionId,
          readStates: readStates.map((rs) => ({
            channelId: rs.channelId,
            lastMessageId: rs.lastMessageId,
            mentionCount: rs.mentionCount,
          })),
          relationships: relationships as any,
          dmChannels: dmChannels as any,
        } satisfies ReadyPayload,
      };

      socket.emit("message", readyPayload);
      resetHeartbeatTimer(socket);
    }

    async function handleResume(
      socket: ReturnType<typeof io.sockets.sockets.get> extends infer S ? NonNullable<S> : never,
      data: { token: string; sessionId: string; seq: number }
    ) {
      try {
        const tokenPayload = verifyToken(data.token);
        const user = await getUserById(tokenPayload.userId);
        if (!user) {
          socket.emit("message", { op: GatewayOp.INVALID_SESSION, d: false });
          return;
        }

        // Check if session exists in Redis
        const sessionData = await getSessionIndex(data.sessionId);
        if (!sessionData) {
          socket.emit("message", { op: GatewayOp.INVALID_SESSION, d: false });
          return;
        }

        // Validate that the session belongs to this user
        const fullSession = await redis.hgetall(`session:${sessionData.socketId}`);
        if (fullSession?.userId && fullSession.userId !== tokenPayload.userId) {
          socket.emit("message", { op: GatewayOp.INVALID_SESSION, d: false });
          return;
        }

        // Restore original intents from Redis instead of defaulting to all
        const userGuilds = await getUserGuilds(user.id);
        session = {
          userId: user.id,
          sessionId: data.sessionId,
          sequence: data.seq,
          heartbeatTimer: null,
          lastHeartbeat: Date.now(),
          guilds: userGuilds.map((g) => g.id),
          intents: sessionData.intents,
          rateLimits: {},
        };

        await storeSession(socket.id, session);
        await storeSessionIndex(data.sessionId, socket.id, session.intents);

        // Rejoin rooms
        for (const guild of userGuilds) {
          socket.join(`guild:${guild.id}`);
        }
        socket.join(`user:${user.id}`);

        await setPresence(user.id, "online", null);

        // Replay missed events from resume buffer
        const missedEvents = await getResumeEvents(data.sessionId, data.seq);

        // If buffer was truncated and can't satisfy the resume, force re-identify
        const bufferLength = await redis.llen(`resume:${data.sessionId}`);
        if (bufferLength >= RESUME_BUFFER_MAX && missedEvents.length > 0) {
          const firstBuffered = missedEvents[0]!.s ?? 0;
          if (firstBuffered > data.seq + 1) {
            // Gap in sequence — events were lost
            socket.emit("message", { op: GatewayOp.INVALID_SESSION, d: true });
            await clearResumeBuffer(data.sessionId);
            return;
          }
        }

        for (const event of missedEvents) {
          socket.emit("message", event);
        }
        // Always advance sequence past the last replayed event
        if (missedEvents.length > 0) {
          session.sequence = (missedEvents[missedEvents.length - 1]!.s ?? data.seq) + 1;
        }

        await clearResumeBuffer(data.sessionId);

        // Send RESUMED
        socket.emit("message", {
          op: GatewayOp.DISPATCH,
          t: "RESUMED",
          s: ++session.sequence,
          d: {},
        });

        resetHeartbeatTimer(socket);
      } catch {
        socket.emit("message", { op: GatewayOp.INVALID_SESSION, d: false });
      }
    }

    async function handlePresenceUpdate(session: GatewaySession, data: PresenceUpdatePayload) {
      const activities = (data as any).activities ?? [];

      // Normalize customStatus: frontend may send a plain string instead of {text, emoji}
      let customStatus = data.customStatus ?? null;
      if (typeof customStatus === "string") {
        customStatus = { text: customStatus };
      }

      await setPresence(
        session.userId,
        data.status,
        customStatus,
        activities
      );

      // Pipeline all presence broadcasts
      if (session.guilds.length > 0) {
        const pipeline = redisPub.pipeline();
        for (const guildId of session.guilds) {
          pipeline.publish(
            `gateway:guild:${guildId}`,
            JSON.stringify({
              event: "PRESENCE_UPDATE",
              data: {
                userId: session.userId,
                guildId,
                status: data.status,
                customStatus,
                activities,
                clientStatus: { web: data.status },
              },
            })
          );
        }
        await pipeline.exec();
      }
    }

    async function handleVoiceStateUpdate(session: GatewaySession, data: VoiceStateUpdatePayload) {
      const { guildId, channelId, selfMute, selfDeaf } = data;

      if (!session.guilds.includes(guildId)) return;

      const voiceState = {
        userId: session.userId,
        guildId,
        channelId, // null = disconnect
        selfMute: selfMute ?? false,
        selfDeaf: selfDeaf ?? false,
        selfStream: false,
        selfVideo: false,
        suppress: false,
      };

      // Forward to zent-stream if configured
      if (config.stream.url) {
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (config.stream.internalKey) headers["x-internal-key"] = config.stream.internalKey;

          if (channelId) {
            const res = await fetch(`${config.stream.url}/api/voice/${guildId}/${channelId}/join`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                userId: session.userId,
                username: "User",
                channelType: 2,
                selfMute: selfMute ?? false,
                selfDeaf: selfDeaf ?? false,
              }),
            });
            if (res.ok) {
              const body = await res.json() as { livekitToken?: string; livekitUrl?: string };
              if (body.livekitToken && body.livekitUrl) {
                // Dispatch to all sessions of this user via Redis
                const vsuPayload = JSON.stringify({
                  event: "VOICE_SERVER_UPDATE",
                  data: { guildId, channelId, token: body.livekitToken, endpoint: body.livekitUrl },
                });
                await redisPub.publish(`gateway:user:${session.userId}`, vsuPayload);
              }
            }
          } else {
            await fetch(`${config.stream.url}/api/voice/${guildId}/leave`, {
              method: "POST",
              headers,
              body: JSON.stringify({ userId: session.userId }),
            });
          }
        } catch (err) {
          console.error("Voice service forwarding failed:", err);
        }
      }

      const vsPayload = JSON.stringify({ event: "VOICE_STATE_UPDATE", data: voiceState });
      await redisPub.publish(`gateway:guild:${guildId}`, vsPayload);
    }

    async function handleHeartbeat(
      socket: ReturnType<typeof io.sockets.sockets.get> extends infer S ? NonNullable<S> : never
    ) {
      if (session) {
        session.lastHeartbeat = Date.now();
        resetHeartbeatTimer(socket);
        // Refresh presence and session TTL
        await Promise.all([
          redis.expire(`presence:${session.userId}`, PRESENCE_TTL),
          refreshSessionTTL(socket.id),
        ]);
      }
      socket.emit("message", { op: GatewayOp.HEARTBEAT_ACK, d: null });
    }

    async function handleRequestGuildMembers(
      socket: ReturnType<typeof io.sockets.sockets.get> extends infer S ? NonNullable<S> : never,
      session: GatewaySession,
      data: RequestGuildMembersPayload
    ) {
      if ((session.intents & GatewayIntentBits.GUILD_MEMBERS) === 0) {
        return;
      }

      let members: any[] = [];

      if (data.userIds && data.userIds.length > 0) {
        const userIds = data.userIds.slice(0, 100);
        const memberRows = await memberRepository.findWithUserByGuildAndUserIds(data.guildId, userIds);

        const foundUserIds = memberRows.map((r: any) => r.member.userId);
        const allRoles = await memberRepository.getMemberRolesByGuildAndUserIds(data.guildId, foundUserIds);

        const roleMap = new Map<string, string[]>();
        for (const r of allRoles) {
          const list = roleMap.get(r.userId) ?? [];
          list.push(r.roleId);
          roleMap.set(r.userId, list);
        }

        members = memberRows.map((row: any) => ({
          ...row.member,
          joinedAt: row.member.joinedAt.toISOString(),
          premiumSince: row.member.premiumSince?.toISOString() ?? null,
          communicationDisabledUntil: row.member.communicationDisabledUntil?.toISOString() ?? null,
          user: row.user ?? null,
          roles: roleMap.get(row.member.userId) ?? [],
        }));
      } else if (data.query !== undefined) {
        const limit = data.limit ?? 1;
        const memberRows = await memberRepository.searchByGuildAndQuery(data.guildId, data.query, limit);

        members = memberRows.map((row: any) => ({
          ...row.member,
          joinedAt: row.member.joinedAt.toISOString(),
          premiumSince: row.member.premiumSince?.toISOString() ?? null,
          communicationDisabledUntil: row.member.communicationDisabledUntil?.toISOString() ?? null,
          user: row.user ?? null,
          roles: [],
        }));
      } else {
        const memberService = await import("../services/member.service.js");
        members = await memberService.getGuildMembers(data.guildId);
        members = members.slice(0, data.limit ?? 1000);
      }

      // Fetch actual presences from Redis if requested
      const presences = data.presences
        ? await fetchPresences(members.map((m: any) => m.user?.id ?? m.userId), data.guildId)
        : undefined;

      // Send GUILD_MEMBERS_CHUNK
      const chunkSize = 1000;
      for (let i = 0; i < members.length; i += chunkSize) {
        const chunk = members.slice(i, i + chunkSize);
        const chunkPresences = presences
          ? presences.slice(i, i + chunkSize)
          : undefined;
        socket.emit("message", {
          op: GatewayOp.DISPATCH,
          t: "GUILD_MEMBERS_CHUNK",
          s: ++session.sequence,
          d: {
            guildId: data.guildId,
            members: chunk,
            chunkIndex: Math.floor(i / chunkSize),
            chunkCount: Math.ceil(members.length / chunkSize),
            notFound: [],
            presences: chunkPresences,
            nonce: data.nonce,
          },
        });
      }
    }

    function resetHeartbeatTimer(
      socket: ReturnType<typeof io.sockets.sockets.get> extends infer S ? NonNullable<S> : never
    ) {
      if (session?.heartbeatTimer) clearTimeout(session.heartbeatTimer);
      if (session) {
        session.heartbeatTimer = setTimeout(() => {
          socket.disconnect(true);
        }, HEARTBEAT_INTERVAL + 10000);
      }
    }
  });

  // ── Graceful shutdown ──
  const shutdown = async () => {
    // Send RECONNECT opcode to all local sessions so clients reconnect to another instance
    for (const [socketId, session] of localSessions) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit("message", { op: GatewayOp.RECONNECT, d: null });
        // Store session index for resume
        await storeSessionIndex(session.sessionId, socketId, session.intents);
        socket.disconnect(true);
      }
    }
    localSessions.clear();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return io;
}

// Presence helper: store in Redis for cross-instance access
async function setPresence(
  userId: string,
  status: string,
  customStatus: { text?: string; emoji?: string } | null,
  activities: unknown[] = []
) {
  const presenceKey = `presence:${userId}`;
  await redis.hset(presenceKey, {
    status,
    customStatus: JSON.stringify(customStatus),
    activities: JSON.stringify(activities),
    lastSeen: Date.now().toString(),
  });
  await redis.expire(presenceKey, PRESENCE_TTL);

  // Update DB - user status
  await userRepository.updatePresence(userId, status, customStatus);

  // Persist activities to userActivities table
  if (activities.length > 0) {
    await userRepository.upsertActivities(userId, activities as any);
  } else {
    await userRepository.deleteActivities(userId);
  }
}

/**
 * Dispatch an event to all members in a guild with per-socket sequence numbers.
 */
export async function dispatchToGuild(
  io: SocketIOServer,
  guildId: string,
  event: string,
  data: unknown
) {
  const socketsInRoom = await io.in(`guild:${guildId}`).fetchSockets();
  for (const remoteSocket of socketsInRoom) {
    const socketSession = localSessions.get(remoteSocket.id);
    if (!socketSession) continue;
    const payload: GatewayPayload = {
      op: GatewayOp.DISPATCH,
      t: event as any,
      s: socketSession.sequence++,
      d: data,
    };
    remoteSocket.emit("message", payload);
  }
}

export async function dispatchToUser(
  io: SocketIOServer,
  userId: string,
  event: string,
  data: unknown
) {
  const socketsInRoom = await io.in(`user:${userId}`).fetchSockets();
  for (const remoteSocket of socketsInRoom) {
    const socketSession = localSessions.get(remoteSocket.id);
    if (!socketSession) continue;
    const payload: GatewayPayload = {
      op: GatewayOp.DISPATCH,
      t: event as any,
      s: socketSession.sequence++,
      d: data,
    };
    remoteSocket.emit("message", payload);
  }
}
