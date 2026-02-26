import { redis, redisPub } from "../config/redis.js";
import * as scheduledMessageService from "../services/scheduled-message.service.js";
import * as messageService from "../services/message.service.js";
import * as channelService from "../services/channel.service.js";
import { messageRepository } from "../repositories/message.repository.js";
import { channelRepository } from "../repositories/channel.repository.js";

const POD_NAME = process.env.HOSTNAME || "default";
const LEADER_KEY = "zent:jobs:leader";
const LEADER_TTL = 30; // seconds
const LEADER_RENEW_INTERVAL = 10_000; // 10s
const MAX_RETRY_ATTEMPTS = 3;

let isLeader = false;

async function tryAcquireLeadership(): Promise<boolean> {
  const result = await redis.set(LEADER_KEY, POD_NAME, "EX", LEADER_TTL, "NX");
  if (result === "OK") {
    isLeader = true;
    return true;
  }
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

        const channel = await channelService.getChannel(scheduled.channelId);
        if (channel?.guildId) {
          const guildId = channel.guildId;
          const payload = JSON.stringify({ event: "MESSAGE_CREATE", data: message });
          const now = Date.now();
          await Promise.all([
            redisPub.publish(`gateway:guild:${guildId}`, payload),
            redisPub.zadd(`guild_events:${guildId}`, now, `${now}:${payload}`),
            redisPub.zremrangebyscore(`guild_events:${guildId}`, "-inf", now - 60000),
          ]);
        }
      } catch (err) {
        console.error(`Failed to send scheduled message ${scheduled.id}:`, err);
        const failKey = `jobs:fail:${scheduled.id}`;
        const attempts = await redis.incr(failKey);
        await redis.expire(failKey, 86400);
        if (attempts >= MAX_RETRY_ATTEMPTS) {
          console.error(`Scheduled message ${scheduled.id} failed ${attempts} times, marking as sent to stop retries`);
          await scheduledMessageService.markAsSent(scheduled.id);
          await redis.del(failKey);
        }
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
    const expired = await messageRepository.findExpired(100);
    if (expired.length === 0) return;

    await messageRepository.deleteByIds(expired.map((m) => m.id));

    // Batch fetch channels for guild dispatch
    const uniqueChannelIds = [...new Set(expired.map((m) => m.channelId))];
    const channels = await channelRepository.findByIds(uniqueChannelIds);
    const channelMap = new Map(channels.map((c: any) => [c.id, c.guildId]));

    // Pipeline all gateway dispatches + event log writes
    const pipeline = redisPub.pipeline();
    const now = Date.now();
    for (const msg of expired) {
      const guildId = channelMap.get(msg.channelId);
      if (guildId) {
        const payload = JSON.stringify({
          event: "MESSAGE_DELETE",
          data: { id: msg.id, channelId: msg.channelId, guildId },
        });
        pipeline.publish(`gateway:guild:${guildId}`, payload);
        pipeline.zadd(`guild_events:${guildId}`, now, `${now}:${payload}`);
        pipeline.zremrangebyscore(`guild_events:${guildId}`, "-inf", now - 60000);
      }
    }
    await pipeline.exec();
  } catch (err) {
    console.error("Error cleaning up expired messages:", err);
  }
}

export function startBackgroundJobs() {
  console.log(`[${POD_NAME}] Starting background jobs with leader election...`);

  const leaderLoop = async () => {
    const wasLeader = isLeader;
    const acquired = await tryAcquireLeadership();
    if (acquired && !wasLeader) {
      console.log(`[${POD_NAME}] Became leader for background jobs`);
    } else if (!acquired && wasLeader) {
      console.log(`[${POD_NAME}] Lost leadership`);
    }
  };

  leaderLoop();
  setInterval(leaderLoop, LEADER_RENEW_INTERVAL);
  setInterval(processScheduledMessages, 10_000);
  setInterval(cleanupExpiredMessages, 30_000);

  setTimeout(() => {
    processScheduledMessages();
    cleanupExpiredMessages();
  }, 2000);
}
