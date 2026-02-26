import { notificationSettingsRepository } from "../repositories/notification-settings.repository.js";

export async function getSettings(userId: string, guildId?: string, channelId?: string) {
  const settings = await notificationSettingsRepository.find(userId, guildId, channelId);

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
  const values: Record<string, any> = {
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

  const result = await notificationSettingsRepository.upsert(
    userId,
    guildId ?? "global",
    channelId ?? "global",
    values,
    setClause,
  );

  return {
    ...result,
    muteUntil: result.muteUntil?.toISOString() ?? null,
  };
}
