import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export async function exportUserData(userId: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) return null;

  const memberships = await db
    .select({
      guildId: schema.members.guildId,
      nickname: schema.members.nickname,
      joinedAt: schema.members.joinedAt,
    })
    .from(schema.members)
    .where(eq(schema.members.userId, userId));

  const messages = await db
    .select({
      id: schema.messages.id,
      channelId: schema.messages.channelId,
      content: schema.messages.content,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(eq(schema.messages.authorId, userId))
    .limit(10000);

  const relationships = await db
    .select()
    .from(schema.relationships)
    .where(eq(schema.relationships.userId, userId));

  const readStates = await db
    .select()
    .from(schema.readStates)
    .where(eq(schema.readStates.userId, userId));

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      bio: user.bio,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
    },
    guilds: memberships.map((m) => ({
      ...m,
      joinedAt: m.joinedAt.toISOString(),
    })),
    messages: messages.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
    relationships: relationships.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    readStates,
  };
}

export async function exportGuildData(guildId: string, requesterId: string) {
  const [guild] = await db
    .select()
    .from(schema.guilds)
    .where(eq(schema.guilds.id, guildId))
    .limit(1);

  if (!guild) return null;
  if (guild.ownerId !== requesterId) return null;

  const channels = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.guildId, guildId));

  const roles = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.guildId, guildId));

  const members = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.guildId, guildId));

  const bans = await db
    .select()
    .from(schema.bans)
    .where(eq(schema.bans.guildId, guildId));

  const emojis = await db
    .select()
    .from(schema.emojis)
    .where(eq(schema.emojis.guildId, guildId));

  return {
    exportedAt: new Date().toISOString(),
    guild: {
      ...guild,
      createdAt: guild.createdAt.toISOString(),
      updatedAt: guild.updatedAt.toISOString(),
    },
    channels: channels.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    roles: roles.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    members: members.map((m) => ({
      ...m,
      joinedAt: m.joinedAt.toISOString(),
      premiumSince: m.premiumSince?.toISOString() ?? null,
      communicationDisabledUntil: m.communicationDisabledUntil?.toISOString() ?? null,
    })),
    bans: bans.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    })),
    emojis,
  };
}
