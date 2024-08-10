import { redisPub } from '../config/redis.js';

// TTL constants (seconds)
const TTL = {
  GUILD: 300,        // 5 min
  CHANNEL: 300,      // 5 min
  MEMBER: 120,       // 2 min
  USER: 180,         // 3 min
  MEMBERS_LIST: 60,  // 1 min
  CHANNELS_LIST: 120,// 2 min
} as const;

const PREFIX = 'cache:';

function key(...parts: string[]): string {
  return PREFIX + parts.join(':');
}

export const apiCache = {
  // Guild cache
  async getGuild(guildId: string): Promise<any | null> {
    const data = await redisPub.get(key('guild', guildId));
    return data ? JSON.parse(data) : null;
  },
  async setGuild(guildId: string, guild: any): Promise<void> {
    await redisPub.setex(key('guild', guildId), TTL.GUILD, JSON.stringify(guild));
  },
  async invalidateGuild(guildId: string): Promise<void> {
    await redisPub.del(key('guild', guildId));
  },

  // Channel cache
  async getChannel(channelId: string): Promise<any | null> {
    const data = await redisPub.get(key('channel', channelId));
    return data ? JSON.parse(data) : null;
  },
  async setChannel(channelId: string, channel: any): Promise<void> {
    await redisPub.setex(key('channel', channelId), TTL.CHANNEL, JSON.stringify(channel));
  },
  async invalidateChannel(channelId: string): Promise<void> {
    await redisPub.del(key('channel', channelId));
  },

  // Channels list for a guild
  async getGuildChannels(guildId: string): Promise<any[] | null> {
    const data = await redisPub.get(key('guild-channels', guildId));
    return data ? JSON.parse(data) : null;
  },
  async setGuildChannels(guildId: string, channels: any[]): Promise<void> {
    await redisPub.setex(key('guild-channels', guildId), TTL.CHANNELS_LIST, JSON.stringify(channels));
  },
  async invalidateGuildChannels(guildId: string): Promise<void> {
    await redisPub.del(key('guild-channels', guildId));
  },

  // Member cache
  async getMember(guildId: string, userId: string): Promise<any | null> {
    const data = await redisPub.get(key('member', guildId, userId));
    return data ? JSON.parse(data) : null;
  },
  async setMember(guildId: string, userId: string, member: any): Promise<void> {
    await redisPub.setex(key('member', guildId, userId), TTL.MEMBER, JSON.stringify(member));
  },
  async invalidateMember(guildId: string, userId: string): Promise<void> {
    await redisPub.del(key('member', guildId, userId));
  },

  // Members list for a guild
  async getGuildMembers(guildId: string): Promise<any[] | null> {
    const data = await redisPub.get(key('guild-members', guildId));
    return data ? JSON.parse(data) : null;
  },
  async setGuildMembers(guildId: string, members: any[]): Promise<void> {
    await redisPub.setex(key('guild-members', guildId), TTL.MEMBERS_LIST, JSON.stringify(members));
  },
  async invalidateGuildMembers(guildId: string): Promise<void> {
    await redisPub.del(key('guild-members', guildId));
  },

  // User profile cache
  async getUser(userId: string): Promise<any | null> {
    const data = await redisPub.get(key('user', userId));
    return data ? JSON.parse(data) : null;
  },
  async setUser(userId: string, user: any): Promise<void> {
    await redisPub.setex(key('user', userId), TTL.USER, JSON.stringify(user));
  },
  async invalidateUser(userId: string): Promise<void> {
    await redisPub.del(key('user', userId));
  },

  // Batch invalidate (when guild is updated)
  async invalidateGuildAll(guildId: string): Promise<void> {
    const keys = await redisPub.keys(PREFIX + 'guild*:' + guildId + '*');
    if (keys.length > 0) {
      await redisPub.del(...keys);
    }
    await redisPub.del(key('guild', guildId));
  },
};
