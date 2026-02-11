import { lte, and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { redis, redisPub } from "../config/redis.js";
import * as scheduledMessageService from "../services/scheduled-message.service.js";
import * as messageService from "../services/message.service.js";
import * as channelService from "../services/channel.service.js";

const POD_NAME = process.env.HOSTNAME || "default";
const LEADER_KEY = "zent:jobs:leader";
const LEADER_TTL = 30; // seconds
const LEADER_RENEW_INTERVAL = 10_000; // 10s

let isLeader = false;

/**
 * Try to acquire leadership using Redis SET NX EX (atomic).
 * Only one replica can hold the lock at a time.
 */
async function tryAcquireLeadership(): Promise<boolean> {
  const result = await redis.set(LEADER_KEY, POD_NAME, "EX", LEADER_TTL, "NX");
  if (result === "OK") {
    isLeader = true;
    return true;
  }
  // Check if we already hold the lock
  const holder = await redis.get(LEADER_KEY);
  if (holder === POD_NAME) {
    await redis.expire(LEADER_KEY, LEADER_TTL);
    isLeader = true;
    return true;
  }
  isLeader = false;
  return false;
}

// Process scheduled messages every 10 seconds
async function processScheduledMessages() {
  if (!isLeader) return;
  try {
    const dueMessages = await scheduledMessageService.getDueScheduledMessages();
    for (const scheduled of dueMessages) {
      try {
        const message = await messageService.createMessage(
          scheduled.channelId,
          scheduled.authorId,
          scheduled.content,
          {}
        );

        await scheduledMessageService.markAsSent(scheduled.id);

        // Dispatch to gateway
        const channel = await channelService.getChannel(scheduled.channelId);
        if (channel?.guildId) {
          const guildId = channel.guildId;
          await redisPub.publish(
            `gateway:guild:${guildId}`,
            JSON.stringify({ event: "MESSAGE_CREATE", data: message })
          );
        }
      } catch (err) {
        console.error(`Failed to send scheduled message ${scheduled.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Error processing scheduled messages:", err);
  }
}

// Clean up expired/disappearing messages every 30 seconds
async function cleanupExpiredMessages() {
  if (!isLeader) return;
  try {
    const expired = await db
      .select({ id: schema.messages.id, channelId: schema.messages.channelId })
      .from(schema.messages)
      .where(
        and(
          isNotNull(schema.messages.expiresAt),
          lte(schema.messages.expiresAt, new Date())
        )
      )
      .limit(100);

    for (const msg of expired) {
      await db.delete(schema.messages).where(eq(schema.messages.id, msg.id));

      const channel = await channelService.getChannel(msg.channelId);
      if (channel?.guildId) {
        const guildId = channel.guildId;
        await redisPub.publish(
          `gateway:guild:${guildId}`,
          JSON.stringify({
            event: "MESSAGE_DELETE",
            data: { id: msg.id, channelId: msg.channelId, guildId },
          })
        );
      }
    }
  } catch (err) {
    console.error("Error cleaning up expired messages:", err);
  }
}

export function startBackgroundJobs() {
  console.log(`[${POD_NAME}] Starting background jobs with leader election...`);

  // Leader election loop - try to acquire/renew every 10s
  const leaderLoop = async () => {
    const acquired = await tryAcquireLeadership();
    if (acquired && !isLeader) {
      console.log(`[${POD_NAME}] Became leader for background jobs`);
    } else if (!acquired && isLeader) {
      console.log(`[${POD_NAME}] Lost leadership`);
    }
    isLeader = acquired;
  };

  // Start leader election immediately, then every 10s
  leaderLoop();
  setInterval(leaderLoop, LEADER_RENEW_INTERVAL);

  // Run scheduled messages check every 10s
  setInterval(processScheduledMessages, 10_000);

  // Run expired message cleanup every 30s
  setInterval(cleanupExpiredMessages, 30_000);

  // Initial run (after a short delay to let leader election happen)
  setTimeout(() => {
    processScheduledMessages();
    cleanupExpiredMessages();
  }, 2000);
}
