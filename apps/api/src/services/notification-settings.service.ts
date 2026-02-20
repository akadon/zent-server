import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export async function getSettings(userId: string, guildId?: string, channelId?: string) {
  const conditions = [eq(schema.notificationSettings.userId, userId)];
  if (guildId) conditions.push(eq(schema.notificationSettings.guildId, guildId));
  if (channelId) conditions.push(eq(schema.notificationSettings.channelId, channelId));

  const settings = await db
    .select()
    .from(schema.notificationSettings)
    .where(and(...conditions));

  return settings.map((s) => ({
    ...s,
    muteUntil: s.muteUntil?.toISOString() ?? null,
  }));
}

export async function upsertSettings(
  userId: string,
  guildId: string | null,
  channelId: string | null,
  data: {
    level?: string;
    suppressEveryone?: boolean;
    suppressRoles?: boolean;
    muted?: boolean;
    muteUntil?: string | null;
  }
) {
  const values: any = {
    userId,
    guildId: guildId ?? "global",
    channelId: channelId ?? "global",
    ...data,
    muteUntil: data.muteUntil ? new Date(data.muteUntil) : null,
  };

  const setClause = {
    ...(data.level !== undefined ? { level: data.level as any } : {}),
    ...(data.suppressEveryone !== undefined ? { suppressEveryone: data.suppressEveryone } : {}),
    ...(data.suppressRoles !== undefined ? { suppressRoles: data.suppressRoles } : {}),
    ...(data.muted !== undefined ? { muted: data.muted } : {}),
    ...(data.muteUntil !== undefined ? { muteUntil: data.muteUntil ? new Date(data.muteUntil) : null } : {}),
  };

  await db
    .insert(schema.notificationSettings)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.notificationSettings.userId,
        schema.notificationSettings.guildId,
        schema.notificationSettings.channelId,
      ],
      set: setClause,
    });

  const [result] = await db
    .select()
    .from(schema.notificationSettings)
    .where(
      and(
        eq(schema.notificationSettings.userId, userId),
        eq(schema.notificationSettings.guildId, guildId ?? "global"),
        eq(schema.notificationSettings.channelId, channelId ?? "global"),
      )
    );

  return {
    ...result!,
    muteUntil: result!.muteUntil?.toISOString() ?? null,
  };
}
