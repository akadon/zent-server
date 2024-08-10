import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { env } from "../config/env.js";
import { redisPub, redisSub, redis } from "../config/redis.js";
import { verifyToken, getUserById } from "../services/auth.service.js";
import { getUserGuilds } from "../services/guild.service.js";
import { getReadStates } from "../services/readstate.service.js";
import { getRelationships, getUserDMChannels } from "../services/relationship.service.js";
import * as voicestateService from "../services/voicestate.service.js";
import { GatewayOp } from "@yxc/gateway-types";
import type {
  GatewayPayload,
  IdentifyPayload,
  HelloPayload,
  ReadyPayload,
  PresenceUpdatePayload,
  VoiceStateUpdatePayload,
  RequestGuildMembersPayload,
} from "@yxc/gateway-types";
import { GatewayIntentBits } from "@yxc/gateway-types";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const HEARTBEAT_INTERVAL = 41250; // ~41s

interface GatewaySession {
  userId: string;
  sessionId: string;
  sequence: number;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  lastHeartbeat: number;
  guilds: string[];
  resumeBuffer: GatewayPayload[];
  intents: number;
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
  if (!requiredIntent) return true; // Events without intent requirements pass through
  return (session.intents & requiredIntent) !== 0;
}

const sessions = new Map<string, GatewaySession>();
// Map sessionId -> socketId for resume
const sessionIndex = new Map<string, string>();

export function createGateway(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    path: "/gateway",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  // Redis adapter for horizontal scaling
  io.adapter(createAdapter(redisPub, redisSub));

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

        // Send to each socket that has the required intent
        for (const remoteSocket of socketsInRoom) {
          const socketSession = sessions.get(remoteSocket.id);
          if (!socketSession) continue;

          // Check if session has required intent (or no intent required)
          if (requiredIntent && (socketSession.intents & requiredIntent) === 0) {
            continue; // Skip this socket - doesn't have required intent
          }

          // Strip message content if MESSAGE_CONTENT intent not set
          let eventData = parsed.data;
          if (parsed.event.startsWith("MESSAGE_") && parsed.data && typeof parsed.data === "object") {
            const messageData = parsed.data as Record<string, unknown>;
            if ((socketSession.intents & GatewayIntentBits.MESSAGE_CONTENT) === 0) {
              // Check if bot is mentioned or is author (exceptions to MESSAGE_CONTENT)
              const mentions = (messageData.mentions as string[]) ?? [];
              const authorId = messageData.authorId as string;
              if (authorId !== socketSession.userId && !mentions.includes(socketSession.userId)) {
                // Strip content, embeds, attachments, components
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
        }
      } else if (channel.startsWith("gateway:user:")) {
        const userId = channel.replace("gateway:user:", "");
        const payload: GatewayPayload = {
          op: GatewayOp.DISPATCH,
          t: parsed.event as any,
          s: 0,
          d: parsed.data,
        };
        io.to(`user:${userId}`).emit("message", payload);
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

          case GatewayOp.VOICE_STATE_UPDATE:
            if (session) {
              await handleVoiceStateUpdate(session, socket, payload.d as VoiceStateUpdatePayload);
            }
            break;

          case GatewayOp.RESUME:
            await handleResume(socket, payload.d as { token: string; sessionId: string; seq: number });
            break;

          case GatewayOp.REQUEST_GUILD_MEMBERS:
            if (session) {
              await handleRequestGuildMembers(socket, session, payload.d as RequestGuildMembersPayload);
            }
            break;
        }
      } catch (err) {
        console.error("Gateway error:", err);
        socket.emit("message", {
          op: GatewayOp.INVALID_SESSION,
          d: false,
        });
      }
    });

    socket.on("disconnect", async () => {
      if (session) {
        if (session.heartbeatTimer) clearTimeout(session.heartbeatTimer);

        // Set user offline
        await setPresence(session.userId, "offline", null);

        // Broadcast offline status to all guilds
        for (const guildId of session.guilds) {
          socket.leave(`guild:${guildId}`);
          io.to(`guild:${guildId}`).emit("message", {
            op: GatewayOp.DISPATCH,
            t: "PRESENCE_UPDATE",
            s: 0,
            d: {
              userId: session.userId,
              guildId,
              status: "offline",
              customStatus: null,
            },
          });
        }

        // Clean up voice state
        for (const guildId of session.guilds) {
          const previous = await voicestateService.leaveVoiceChannel(session.userId, guildId);
          if (previous) {
            io.to(`guild:${guildId}`).emit("message", {
              op: GatewayOp.DISPATCH,
              t: "VOICE_STATE_UPDATE",
              s: 0,
              d: { userId: session.userId, guildId, channelId: null, sessionId: session.sessionId },
            });
          }
        }

        // Keep session in index for 5 minutes for resume
        const sid = session.sessionId;
        setTimeout(() => {
          sessionIndex.delete(sid);
        }, 5 * 60 * 1000);

        sessions.delete(socket.id);
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
      const userGuilds = await getUserGuilds(user.id);
      const readStates = await getReadStates(user.id);
      const relationships = await getRelationships(user.id);
      const dmChannels = await getUserDMChannels(user.id);

      session = {
        userId: user.id,
        sessionId,
        sequence: 0,
        heartbeatTimer: null,
        lastHeartbeat: Date.now(),
        guilds: userGuilds.map((g) => g.id),
        resumeBuffer: [],
        intents: data.intents ?? 0xFFFFFFFF, // Default: all intents if not specified
      };
      sessions.set(socket.id, session);
      sessionIndex.set(sessionId, socket.id);

      // Join guild rooms
      for (const guild of userGuilds) {
        socket.join(`guild:${guild.id}`);
      }
      socket.join(`user:${user.id}`);

      // Set user online
      await setPresence(user.id, "online", null);

      // Broadcast online to all guilds
      for (const guild of userGuilds) {
        io.to(`guild:${guild.id}`).emit("message", {
          op: GatewayOp.DISPATCH,
          t: "PRESENCE_UPDATE",
          s: 0,
          d: { userId: user.id, guildId: guild.id, status: "online", customStatus: null },
        });
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

        // Check if session exists
        const oldSocketId = sessionIndex.get(data.sessionId);
        if (!oldSocketId) {
          // Session expired, must re-identify
          socket.emit("message", { op: GatewayOp.INVALID_SESSION, d: false });
          return;
        }

        // Recreate session
        const userGuilds = await getUserGuilds(user.id);
        session = {
          userId: user.id,
          sessionId: data.sessionId,
          sequence: data.seq,
          heartbeatTimer: null,
          lastHeartbeat: Date.now(),
          guilds: userGuilds.map((g) => g.id),
          resumeBuffer: [],
          intents: 0xFFFFFFFF, // On resume, use all intents (original intents not preserved)
        };
        sessions.set(socket.id, session);
        sessionIndex.set(data.sessionId, socket.id);

        // Rejoin rooms
        for (const guild of userGuilds) {
          socket.join(`guild:${guild.id}`);
        }
        socket.join(`user:${user.id}`);

        // Set online
        await setPresence(user.id, "online", null);

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
      await setPresence(
        session.userId,
        data.status,
        data.customStatus ?? null,
        activities
      );

      // Broadcast to all guilds
      for (const guildId of session.guilds) {
        io.to(`guild:${guildId}`).emit("message", {
          op: GatewayOp.DISPATCH,
          t: "PRESENCE_UPDATE",
          s: 0,
          d: {
            userId: session.userId,
            guildId,
            status: data.status,
            customStatus: data.customStatus ?? null,
            activities,
            clientStatus: { web: data.status },
          },
        });
      }
    }

    async function handleVoiceStateUpdate(
      session: GatewaySession,
      socket: ReturnType<typeof io.sockets.sockets.get> extends infer S ? NonNullable<S> : never,
      data: VoiceStateUpdatePayload
    ) {
      if (data.channelId === null) {
        // Leave voice
        const previous = await voicestateService.leaveVoiceChannel(session.userId, data.guildId);
        if (previous) {
          io.to(`guild:${data.guildId}`).emit("message", {
            op: GatewayOp.DISPATCH,
            t: "VOICE_STATE_UPDATE",
            s: 0,
            d: {
              userId: session.userId,
              guildId: data.guildId,
              channelId: null,
              sessionId: session.sessionId,
            },
          });
        }
      } else {
        // Join voice
        const state = await voicestateService.joinVoiceChannel(
          session.userId,
          data.guildId,
          data.channelId,
          session.sessionId,
          { selfMute: data.selfMute, selfDeaf: data.selfDeaf }
        );

        io.to(`guild:${data.guildId}`).emit("message", {
          op: GatewayOp.DISPATCH,
          t: "VOICE_STATE_UPDATE",
          s: 0,
          d: state,
        });

        // Send voice server info back to the requesting client
        socket.emit("message", {
          op: GatewayOp.DISPATCH,
          t: "VOICE_SERVER_UPDATE",
          s: 0,
          d: {
            guildId: data.guildId,
            token: state.livekitToken,
            endpoint: state.livekitUrl,
          },
        });
      }
    }

    function handleHeartbeat(
      socket: ReturnType<typeof io.sockets.sockets.get> extends infer S ? NonNullable<S> : never
    ) {
      if (session) {
        session.lastHeartbeat = Date.now();
        resetHeartbeatTimer(socket);
      }
      socket.emit("message", { op: GatewayOp.HEARTBEAT_ACK, d: null });
    }

    async function handleRequestGuildMembers(
      socket: ReturnType<typeof io.sockets.sockets.get> extends infer S ? NonNullable<S> : never,
      session: GatewaySession,
      data: RequestGuildMembersPayload
    ) {
      // Check if session has GUILD_MEMBERS intent
      if ((session.intents & GatewayIntentBits.GUILD_MEMBERS) === 0) {
        return; // Silently ignore if no intent
      }

      // Import member service dynamically to avoid circular deps
      const memberService = await import("../services/member.service.js");

      let members: any[] = [];

      if (data.userIds && data.userIds.length > 0) {
        // Fetch specific members
        for (const userId of data.userIds.slice(0, 100)) {
          const member = await memberService.getMember(data.guildId, userId);
          if (member) members.push(member);
        }
      } else if (data.query !== undefined) {
        // Search members by query
        const allMembers = await memberService.getGuildMembers(data.guildId);
        const query = data.query.toLowerCase();
        members = allMembers.filter((m: any) => {
          const username = m.user?.username?.toLowerCase() ?? "";
          const nick = m.nickname?.toLowerCase() ?? "";
          return username.startsWith(query) || nick.startsWith(query);
        }).slice(0, data.limit ?? 1);
      } else {
        // Get all members (paginated)
        members = await memberService.getGuildMembers(data.guildId);
        members = members.slice(0, data.limit ?? 1000);
      }

      // Send GUILD_MEMBERS_CHUNK
      const chunkSize = 1000;
      for (let i = 0; i < members.length; i += chunkSize) {
        const chunk = members.slice(i, i + chunkSize);
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
            presences: data.presences ? chunk.map((m: any) => ({
              userId: m.user?.id ?? m.userId,
              guildId: data.guildId,
              status: "online", // Would need to fetch actual presence
            })) : undefined,
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

  return io;
}

// Presence helper: store in Redis for cross-instance access
async function setPresence(
  userId: string,
  status: string,
  customStatus: { text?: string; emoji?: string } | null,
  activities: unknown[] = []
) {
  await redis.hset(`presence:${userId}`, {
    status,
    customStatus: JSON.stringify(customStatus),
    activities: JSON.stringify(activities),
    lastSeen: Date.now().toString(),
  });

  // Update DB - user status
  await db
    .update(schema.users)
    .set({
      status: status as any,
      customStatus,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));

  // Persist activities to userActivities table
  if (activities.length > 0) {
    await db
      .insert(schema.userActivities)
      .values({
        userId,
        activities: activities as any,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.userActivities.userId,
        set: {
          activities: activities as any,
          updatedAt: new Date(),
        },
      });
  } else {
    // Clear activities
    await db
      .delete(schema.userActivities)
      .where(eq(schema.userActivities.userId, userId));
  }
}

/**
 * Dispatch an event to all members in a guild.
 */
export function dispatchToGuild(
  io: SocketIOServer,
  guildId: string,
  event: string,
  data: unknown
) {
  const payload: GatewayPayload = {
    op: GatewayOp.DISPATCH,
    t: event as any,
    s: 0,
    d: data,
  };
  io.to(`guild:${guildId}`).emit("message", payload);
}

export function dispatchToUser(
  io: SocketIOServer,
  userId: string,
  event: string,
  data: unknown
) {
  const payload: GatewayPayload = {
    op: GatewayOp.DISPATCH,
    t: event as any,
    s: 0,
    d: data,
  };
  io.to(`user:${userId}`).emit("message", payload);
}
