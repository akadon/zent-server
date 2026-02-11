import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { redisPub } from "../config/redis.js";

export interface AutoModConfig {
  enabled: boolean;
  keywordFilters: {
    enabled: boolean;
    blockedWords: string[];
    action: "delete" | "warn" | "timeout";
  };
  mentionSpam: {
    enabled: boolean;
    maxMentions: number;
    action: "delete" | "warn" | "timeout";
  };
  linkFilter: {
    enabled: boolean;
    blockAllLinks: boolean;
    whitelist: string[];
    action: "delete" | "warn" | "timeout";
  };
  antiRaid: {
    enabled: boolean;
    joinRateLimit: number;
    joinRateWindow: number;
    action: "lockdown" | "kick" | "notify";
  };
}

const DEFAULT_CONFIG: AutoModConfig = {
  enabled: false,
  keywordFilters: {
    enabled: false,
    blockedWords: [],
    action: "delete",
  },
  mentionSpam: {
    enabled: false,
    maxMentions: 10,
    action: "delete",
  },
  linkFilter: {
    enabled: false,
    blockAllLinks: false,
    whitelist: [],
    action: "delete",
  },
  antiRaid: {
    enabled: false,
    joinRateLimit: 10,
    joinRateWindow: 60,
    action: "notify",
  },
};

// In-memory cache with TTL
const configCache = new Map<string, { config: AutoModConfig; cachedAt: number }>();
const CACHE_TTL = 60000; // 1 minute

export async function getConfig(guildId: string): Promise<AutoModConfig> {
  // Check cache first
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.config;
  }

  const [row] = await db
    .select()
    .from(schema.automodConfig)
    .where(eq(schema.automodConfig.guildId, guildId))
    .limit(1);

  if (!row) {
    return { ...DEFAULT_CONFIG };
  }

  const config: AutoModConfig = {
    enabled: row.enabled,
    keywordFilters: row.keywordFilters as AutoModConfig["keywordFilters"],
    mentionSpam: row.mentionSpam as AutoModConfig["mentionSpam"],
    linkFilter: row.linkFilter as AutoModConfig["linkFilter"],
    antiRaid: row.antiRaid as AutoModConfig["antiRaid"],
  };

  configCache.set(guildId, { config, cachedAt: Date.now() });
  return config;
}

export async function setConfig(guildId: string, config: AutoModConfig): Promise<void> {
  const existing = await db
    .select({ guildId: schema.automodConfig.guildId })
    .from(schema.automodConfig)
    .where(eq(schema.automodConfig.guildId, guildId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.automodConfig)
      .set({
        enabled: config.enabled,
        keywordFilters: config.keywordFilters,
        mentionSpam: config.mentionSpam,
        linkFilter: config.linkFilter,
        antiRaid: config.antiRaid,
      })
      .where(eq(schema.automodConfig.guildId, guildId));
  } else {
    await db.insert(schema.automodConfig).values({
      guildId,
      enabled: config.enabled,
      keywordFilters: config.keywordFilters,
      mentionSpam: config.mentionSpam,
      linkFilter: config.linkFilter,
      antiRaid: config.antiRaid,
    });
  }

  // Update cache
  configCache.set(guildId, { config, cachedAt: Date.now() });

  // Dispatch event
  await redisPub.publish(
    `gateway:guild:${guildId}`,
    JSON.stringify({
      event: "AUTO_MODERATION_RULE_UPDATE",
      data: { guildId, config },
    })
  );
}

export async function deleteConfig(guildId: string): Promise<void> {
  await db
    .delete(schema.automodConfig)
    .where(eq(schema.automodConfig.guildId, guildId));

  configCache.delete(guildId);
}

const URL_REGEX = /https?:\/\/[^\s<]+/gi;

export async function checkMessage(
  guildId: string,
  content: string,
  _authorId: string,
  mentionCount: number
): Promise<{ allowed: boolean; reason?: string; action?: string }> {
  const config = await getConfig(guildId);
  if (!config.enabled) return { allowed: true };

  // Keyword filter
  if (config.keywordFilters.enabled && config.keywordFilters.blockedWords.length > 0) {
    const lower = content.toLowerCase();
    for (const word of config.keywordFilters.blockedWords) {
      if (lower.includes(word.toLowerCase())) {
        return {
          allowed: false,
          reason: `Message contains blocked word: ${word}`,
          action: config.keywordFilters.action,
        };
      }
    }
  }

  // Mention spam
  if (config.mentionSpam.enabled && mentionCount > config.mentionSpam.maxMentions) {
    return {
      allowed: false,
      reason: `Too many mentions (${mentionCount} > ${config.mentionSpam.maxMentions})`,
      action: config.mentionSpam.action,
    };
  }

  // Link filter
  if (config.linkFilter.enabled) {
    const urls = content.match(URL_REGEX);
    if (urls && urls.length > 0) {
      if (config.linkFilter.blockAllLinks) {
        const allWhitelisted = urls.every((url) =>
          config.linkFilter.whitelist.some((domain) => url.includes(domain))
        );
        if (!allWhitelisted) {
          return {
            allowed: false,
            reason: "Message contains non-whitelisted links",
            action: config.linkFilter.action,
          };
        }
      } else if (config.linkFilter.whitelist.length > 0) {
        const hasBlocked = urls.some(
          (url) => !config.linkFilter.whitelist.some((domain) => url.includes(domain))
        );
        if (hasBlocked) {
          return {
            allowed: false,
            reason: "Message contains non-whitelisted links",
            action: config.linkFilter.action,
          };
        }
      }
    }
  }

  return { allowed: true };
}

// Use Redis for distributed join rate limiting
const JOIN_RATE_KEY_PREFIX = "automod:joinrate:";

export async function checkJoinRate(
  guildId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const config = await getConfig(guildId);
  if (!config.enabled || !config.antiRaid.enabled) return { allowed: true };

  const key = `${JOIN_RATE_KEY_PREFIX}${guildId}`;
  const now = Date.now();
  const windowMs = config.antiRaid.joinRateWindow * 1000;

  // Use Redis sorted set for distributed rate limiting
  const multi = redisPub.multi();

  // Remove old entries outside window
  multi.zremrangebyscore(key, 0, now - windowMs);

  // Add current join
  multi.zadd(key, now, `${now}-${Math.random()}`);

  // Count recent joins
  multi.zcard(key);

  // Set expiry on key
  multi.expire(key, config.antiRaid.joinRateWindow + 10);

  const results = await multi.exec();
  const recentCount = (results?.[2]?.[1] as number) ?? 0;

  if (recentCount > config.antiRaid.joinRateLimit) {
    return {
      allowed: false,
      reason: `Join rate exceeded (${recentCount} joins in ${config.antiRaid.joinRateWindow}s)`,
    };
  }

  return { allowed: true };
}

// Record automod action for audit/logging
export async function recordAction(
  guildId: string,
  userId: string,
  action: string,
  reason: string,
  messageId?: string,
  channelId?: string
): Promise<void> {
  await redisPub.publish(
    `gateway:guild:${guildId}`,
    JSON.stringify({
      event: "AUTO_MODERATION_ACTION_EXECUTION",
      data: {
        guildId,
        userId,
        action,
        reason,
        messageId,
        channelId,
        executedAt: new Date().toISOString(),
      },
    })
  );
}
