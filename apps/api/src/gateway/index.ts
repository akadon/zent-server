import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { URL } from "url";
import Redis from "ioredis";
import crypto from "crypto";
import { env } from "../config/env.js";
import { config } from "../config/config.js";
import { redisPub, redisSub, redis } from "../config/redis.js";
import { verifyToken, getUserById } from "../services/auth.service.js";
import { getUserGuilds } from "../services/guild.service.js";
import { getReadStates } from "../services/readstate.service.js";
import { getRelationships, getUserDMChannels } from "../services/relationship.service.js";
import { GatewayOp, GatewayIntentBits } from "@yxc/gateway-types";
import type {
  GatewayPayload,
  IdentifyPayload,
  HelloPayload,
  ReadyPayload,
  PresenceUpdatePayload,
  RequestGuildMembersPayload,
  VoiceStateUpdatePayload,
} from "@yxc/gateway-types";
import { memberRepository } from "../repositories/member.repository.js";
import { userRepository } from "../repositories/user.repository.js";

// ── Constants ──

const HEARTBEAT_INTERVAL = 41250; // ~41s
const PRESENCE_TTL = 300; // 5 minutes
const SESSION_TTL = Math.ceil(HEARTBEAT_INTERVAL / 1000) + 30;
const RESUME_WINDOW = 300; // 5 minutes
const RESUME_BUFFER_MAX = 250;
const RESUME_BUFFER_TTL = 300; // 5 minutes
const RESUME_CIRCUIT_BREAKER_THRESHOLD = 100_000;
const MAX_CONNECTIONS = 500_000;
const WS_PING_INTERVAL = 30_000; // 30s TCP-level liveness check

// ── Types ──

interface GatewaySession {
  connId: string;
  userId: string;
  sessionId: string;
  sequence: number;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  lastHeartbeat: number;
  guilds: string[];
  intents: number;
  rateLimits: Record<number, { count: number; windowStart: number }>;
}

// ── Per-opcode rate limits: [maxCount, windowMs] ──

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

// ── Event → Intent mapping ──

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

// ── Room management ──

const guildRooms = new Map<string, Set<WebSocket>>();
const userRooms = new Map<string, Set<WebSocket>>();
const sessions = new Map<WebSocket, GatewaySession>();

function addToRoom(rooms: Map<string, Set<WebSocket>>, key: string, ws: WebSocket) {
  let room = rooms.get(key);
  if (!room) { room = new Set(); rooms.set(key, room); }
  room.add(ws);
}

function removeFromRoom(rooms: Map<string, Set<WebSocket>>, key: string, ws: WebSocket) {
  const room = rooms.get(key);
  if (room) {
    room.delete(ws);
    if (room.size === 0) rooms.delete(key);
  }
}

function send(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── Redis-backed session storage ──

async function storeSession(connId: string, session: GatewaySession) {
  const key = `session:${connId}`;
  await redis.hset(key, {
    userId: session.userId,
    sessionId: session.sessionId,
    sequence: session.sequence.toString(),
    intents: session.intents.toString(),
    guilds: JSON.stringify(session.guilds),
  });
  await redis.expire(key, SESSION_TTL);
}

async function storeSessionIndex(sessionId: string, connId: string, intents: number) {
  const key = `session_idx:${sessionId}`;
  await redis.hset(key, { socketId: connId, intents: intents.toString() });
  await redis.expire(key, RESUME_WINDOW);
}

async function getSessionIndex(sessionId: string): Promise<{ socketId: string; intents: number } | null> {
  const data = await redis.hgetall(`session_idx:${sessionId}`);
  if (!data || !data.socketId) return null;
  return { socketId: data.socketId, intents: parseInt(data.intents ?? "0xFFFFFFFF", 10) };
}

async function removeSessionRedis(connId: string) {
  await redis.del(`session:${connId}`);
}

async function refreshSessionTTL(connId: string) {
  await redis.expire(`session:${connId}`, SESSION_TTL);
}

// ── Resume buffer in Redis ──

async function pushResumeEvent(sessionId: string, payload: GatewayPayload) {
  const resumeKeyCount = await redis.dbsize();
  if (resumeKeyCount > RESUME_CIRCUIT_BREAKER_THRESHOLD) return;

  const key = `resume:${sessionId}`;
  await redis.rpush(key, JSON.stringify(payload));
  await redis.ltrim(key, -RESUME_BUFFER_MAX, -1);
  await redis.expire(key, RESUME_BUFFER_TTL);
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

// ── Gateway factory ──

export function createGateway(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1_000_000,
    perMessageDeflate: false,
  });

  // Handle HTTP upgrade for /gateway path
  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;
    if (pathname === "/gateway") {
      if (sessions.size >= MAX_CONNECTIONS) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
    // Other paths: don't touch — let Fastify or other handlers deal with them
  });

  // Stale session cleanup every 60s
  setInterval(() => {
    const now = Date.now();
    for (const [ws, sess] of sessions) {
      if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        sessions.delete(ws);
      } else {
        for (const op of Object.keys(sess.rateLimits)) {
          const opNum = Number(op);
          const bucket = sess.rateLimits[opNum];
          if (bucket && now - bucket.windowStart > 120_000) {
            delete sess.rateLimits[opNum];
          }
        }
      }
    }
  }, 60_000);

  // TCP-level liveness via ws ping/pong (detects dead connections faster than app heartbeat)
  const pingTimer = setInterval(() => {
    for (const [ws] of sessions) {
      if ((ws as any).__alive === false) {
        ws.terminate();
        continue;
      }
      (ws as any).__alive = false;
      ws.ping();
    }
  }, WS_PING_INTERVAL);

  // ── Redis Pub/Sub for cross-instance event distribution ──

  const gatewaySub = new Redis(env.REDIS_URL);
  gatewaySub.psubscribe("gateway:guild:*", "gateway:user:*");

  gatewaySub.on("pmessage", async (_pattern, channel, message) => {
    try {
      const parsed = JSON.parse(message) as { event: string; data: unknown };
      const requiredIntent = EVENT_INTENTS[parsed.event];

      if (channel.startsWith("gateway:guild:")) {
        const guildId = channel.replace("gateway:guild:", "");
        const sockets = guildRooms.get(guildId);
        if (!sockets) return;

        for (const ws of sockets) {
          const socketSession = sessions.get(ws);
          if (!socketSession) continue;
          if (requiredIntent && (socketSession.intents & requiredIntent) === 0) continue;

          let eventData = parsed.data;

          // Redact MESSAGE_CONTENT for clients without the intent
          if (parsed.event.startsWith("MESSAGE_") && parsed.data && typeof parsed.data === "object") {
            const messageData = parsed.data as Record<string, unknown>;
            if ((socketSession.intents & GatewayIntentBits.MESSAGE_CONTENT) === 0) {
              const mentions = (messageData.mentions as string[]) ?? [];
              const authorId = messageData.authorId as string;
              if (authorId !== socketSession.userId && !mentions.includes(socketSession.userId)) {
                eventData = { ...messageData, content: "", embeds: [], attachments: [], components: [] };
              }
            }
          }

          const payload: GatewayPayload = {
            op: GatewayOp.DISPATCH,
            t: parsed.event as any,
            s: socketSession.sequence++,
            d: eventData,
          };
          send(ws, payload);
          pushResumeEvent(socketSession.sessionId, payload);
        }
      } else if (channel.startsWith("gateway:user:")) {
        const userId = channel.replace("gateway:user:", "");

        // Handle session invalidation
        if (parsed.event === "SESSION_INVALIDATE") {
          const invalidateData = parsed.data as { exceptSocketId?: string | null };
          const sockets = userRooms.get(userId);
          if (!sockets) return;

          for (const ws of [...sockets]) {
            const socketSession = sessions.get(ws);
            if (invalidateData.exceptSocketId && socketSession?.sessionId === invalidateData.exceptSocketId) continue;
            if (socketSession) {
              if (socketSession.heartbeatTimer) clearTimeout(socketSession.heartbeatTimer);
              await removeSessionRedis(socketSession.connId);
              await clearResumeBuffer(socketSession.sessionId);
              sessions.delete(ws);
            }
            send(ws, { op: GatewayOp.INVALID_SESSION, d: false });
            ws.close();
          }
          return;
        }

        const sockets = userRooms.get(userId);
        if (!sockets) return;

        for (const ws of sockets) {
          const socketSession = sessions.get(ws);
          if (!socketSession) continue;
          const payload: GatewayPayload = {
            op: GatewayOp.DISPATCH,
            t: parsed.event as any,
            s: socketSession.sequence++,
            d: parsed.data,
          };
          send(ws, payload);
          pushResumeEvent(socketSession.sessionId, payload);
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  // ── Connection handler ──

  wss.on("connection", (ws: WebSocket) => {
    const connId = crypto.randomUUID();
    let session: GatewaySession | null = null;

    (ws as any).__alive = true;
    ws.on("pong", () => { (ws as any).__alive = true; });

    // Send HELLO immediately
    send(ws, {
      op: GatewayOp.HELLO,
      d: { heartbeatInterval: HEARTBEAT_INTERVAL } satisfies HelloPayload,
    });

    // ── Message handler ──

    ws.on("message", async (raw: Buffer | string) => {
      try {
        const payload = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as GatewayPayload;

        if (session && !checkOpcodeRateLimit(session, payload.op)) {
          send(ws, { op: GatewayOp.INVALID_SESSION, d: false });
          return;
        }

        switch (payload.op) {
          case GatewayOp.IDENTIFY:
            await handleIdentify(ws, connId, payload.d as IdentifyPayload);
            break;
          case GatewayOp.HEARTBEAT:
            await handleHeartbeat(ws);
            break;
          case GatewayOp.PRESENCE_UPDATE:
            if (session) await handlePresenceUpdate(session, payload.d as PresenceUpdatePayload);
            break;
          case GatewayOp.RESUME:
            await handleResume(ws, connId, payload.d as { token: string; sessionId: string; seq: number });
            break;
          case GatewayOp.VOICE_STATE_UPDATE:
            if (session) await handleVoiceStateUpdate(session, payload.d as VoiceStateUpdatePayload);
            break;
          case GatewayOp.REQUEST_GUILD_MEMBERS:
            if (session) await handleRequestGuildMembers(ws, session, payload.d as RequestGuildMembersPayload);
            break;
        }
      } catch (err: any) {
        if (err?.name === "TokenExpiredError" || err?.name === "JsonWebTokenError") {
          send(ws, { op: GatewayOp.INVALID_SESSION, d: false });
        } else {
          console.error("Gateway error:", err);
        }
      }
    });

    // ── Disconnect handler ──

    ws.on("close", async () => {
      (ws as any).__alive = false;

      if (session) {
        if (session.heartbeatTimer) clearTimeout(session.heartbeatTimer);
        await setPresence(session.userId, "offline", null);

        if (session.guilds.length > 0) {
          const pipeline = redisPub.pipeline();
          for (const guildId of session.guilds) {
            removeFromRoom(guildRooms, guildId, ws);
            pipeline.publish(
              `gateway:guild:${guildId}`,
              JSON.stringify({
                event: "PRESENCE_UPDATE",
                data: { userId: session.userId, guildId, status: "offline", customStatus: null },
              })
            );
          }
          await pipeline.exec();
        }

        removeFromRoom(userRooms, session.userId, ws);
        await storeSessionIndex(session.sessionId, session.connId, session.intents);
        await removeSessionRedis(session.connId);
      }

      sessions.delete(ws);
    });

    ws.on("error", () => {
      // Error always precedes close; cleanup happens in close handler
    });

    // ── Handler implementations ──

    async function handleIdentify(ws: WebSocket, connId: string, data: IdentifyPayload) {
      if (sessions.size >= MAX_CONNECTIONS) {
        send(ws, { op: GatewayOp.INVALID_SESSION, d: { message: "Server at capacity, please retry later" } });
        ws.close();
        return;
      }

      const tokenPayload = verifyToken(data.token);
      const user = await getUserById(tokenPayload.userId);
      if (!user) {
        send(ws, { op: GatewayOp.INVALID_SESSION, d: false });
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
        connId,
        userId: user.id,
        sessionId,
        sequence: 0,
        heartbeatTimer: null,
        lastHeartbeat: Date.now(),
        guilds: userGuilds.map((g) => g.id),
        intents: data.intents ?? 0xFFFFFFFF,
        rateLimits: {},
      };

      sessions.set(ws, session);
      await storeSession(connId, session);
      await storeSessionIndex(sessionId, connId, session.intents);

      // Join rooms
      for (const guild of userGuilds) {
        addToRoom(guildRooms, guild.id, ws);
      }
      addToRoom(userRooms, user.id, ws);

      // Set user online
      await setPresence(user.id, "online", null);

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

      send(ws, readyPayload);
      resetHeartbeatTimer(ws);
    }

    async function handleResume(
      ws: WebSocket,
      connId: string,
      data: { token: string; sessionId: string; seq: number }
    ) {
      try {
        const tokenPayload = verifyToken(data.token);
        const user = await getUserById(tokenPayload.userId);
        if (!user) {
          send(ws, { op: GatewayOp.INVALID_SESSION, d: false });
          return;
        }

        const sessionData = await getSessionIndex(data.sessionId);
        if (!sessionData) {
          send(ws, { op: GatewayOp.INVALID_SESSION, d: false });
          return;
        }

        // Validate that the session belongs to this user
        const fullSession = await redis.hgetall(`session:${sessionData.socketId}`);
        if (fullSession?.userId && fullSession.userId !== tokenPayload.userId) {
          send(ws, { op: GatewayOp.INVALID_SESSION, d: false });
          return;
        }

        const userGuilds = await getUserGuilds(user.id);
        session = {
          connId,
          userId: user.id,
          sessionId: data.sessionId,
          sequence: data.seq,
          heartbeatTimer: null,
          lastHeartbeat: Date.now(),
          guilds: userGuilds.map((g) => g.id),
          intents: sessionData.intents,
          rateLimits: {},
        };

        sessions.set(ws, session);
        await storeSession(connId, session);
        await storeSessionIndex(data.sessionId, connId, session.intents);

        // Rejoin rooms
        for (const guild of userGuilds) {
          addToRoom(guildRooms, guild.id, ws);
        }
        addToRoom(userRooms, user.id, ws);

        await setPresence(user.id, "online", null);

        // Replay missed events
        const missedEvents = await getResumeEvents(data.sessionId, data.seq);

        const bufferLength = await redis.llen(`resume:${data.sessionId}`);
        if (bufferLength >= RESUME_BUFFER_MAX && missedEvents.length > 0) {
          const firstBuffered = missedEvents[0]!.s ?? 0;
          if (firstBuffered > data.seq + 1) {
            send(ws, { op: GatewayOp.INVALID_SESSION, d: true });
            await clearResumeBuffer(data.sessionId);
            return;
          }
        }

        for (const event of missedEvents) {
          send(ws, event);
        }
        if (missedEvents.length > 0) {
          session.sequence = (missedEvents[missedEvents.length - 1]!.s ?? data.seq) + 1;
        }

        await clearResumeBuffer(data.sessionId);

        send(ws, {
          op: GatewayOp.DISPATCH,
          t: "RESUMED",
          s: ++session.sequence,
          d: {},
        });

        resetHeartbeatTimer(ws);
      } catch {
        send(ws, { op: GatewayOp.INVALID_SESSION, d: false });
      }
    }

    async function handlePresenceUpdate(session: GatewaySession, data: PresenceUpdatePayload) {
      const activities = (data as any).activities ?? [];

      let customStatus = data.customStatus ?? null;
      if (typeof customStatus === "string") {
        customStatus = { text: customStatus };
      }

      await setPresence(session.userId, data.status, customStatus, activities);

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
        channelId,
        selfMute: selfMute ?? false,
        selfDeaf: selfDeaf ?? false,
        selfStream: false,
        selfVideo: false,
        suppress: false,
      };

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

    async function handleHeartbeat(ws: WebSocket) {
      if (session) {
        session.lastHeartbeat = Date.now();
        resetHeartbeatTimer(ws);
        await Promise.all([
          redis.expire(`presence:${session.userId}`, PRESENCE_TTL),
          refreshSessionTTL(session.connId),
        ]);
      }
      send(ws, { op: GatewayOp.HEARTBEAT_ACK, d: null });
    }

    async function handleRequestGuildMembers(
      ws: WebSocket,
      session: GatewaySession,
      data: RequestGuildMembersPayload
    ) {
      if ((session.intents & GatewayIntentBits.GUILD_MEMBERS) === 0) return;

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

      const presences = data.presences
        ? await fetchPresences(members.map((m: any) => m.user?.id ?? m.userId), data.guildId)
        : undefined;

      // Send GUILD_MEMBERS_CHUNK in 1000-member chunks
      const chunkSize = 1000;
      for (let i = 0; i < members.length; i += chunkSize) {
        const chunk = members.slice(i, i + chunkSize);
        const chunkPresences = presences ? presences.slice(i, i + chunkSize) : undefined;
        send(ws, {
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

    function resetHeartbeatTimer(ws: WebSocket) {
      if (session?.heartbeatTimer) clearTimeout(session.heartbeatTimer);
      if (session) {
        session.heartbeatTimer = setTimeout(() => {
          ws.terminate();
        }, HEARTBEAT_INTERVAL + 10000);
      }
    }
  });

  // ── Graceful shutdown ──

  const shutdown = async () => {
    clearInterval(pingTimer);
    for (const [ws, sess] of sessions) {
      send(ws, { op: GatewayOp.RECONNECT, d: null });
      await storeSessionIndex(sess.sessionId, sess.connId, sess.intents);
      ws.close();
    }
    sessions.clear();
    guildRooms.clear();
    userRooms.clear();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return wss;
}

// ── Presence helper ──

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

  await userRepository.updatePresence(userId, status, customStatus);

  if (activities.length > 0) {
    await userRepository.upsertActivities(userId, activities as any);
  } else {
    await userRepository.deleteActivities(userId);
  }
}

// ── Direct dispatch helpers (for same-process use) ──

export function dispatchToGuild(guildId: string, event: string, data: unknown) {
  const sockets = guildRooms.get(guildId);
  if (!sockets) return;
  for (const ws of sockets) {
    const socketSession = sessions.get(ws);
    if (!socketSession) continue;
    const payload: GatewayPayload = {
      op: GatewayOp.DISPATCH,
      t: event as any,
      s: socketSession.sequence++,
      d: data,
    };
    send(ws, payload);
  }
}

export function dispatchToUser(userId: string, event: string, data: unknown) {
  const sockets = userRooms.get(userId);
  if (!sockets) return;
  for (const ws of sockets) {
    const socketSession = sessions.get(ws);
    if (!socketSession) continue;
    const payload: GatewayPayload = {
      op: GatewayOp.DISPATCH,
      t: event as any,
      s: socketSession.sequence++,
      d: data,
    };
    send(ws, payload);
  }
}
