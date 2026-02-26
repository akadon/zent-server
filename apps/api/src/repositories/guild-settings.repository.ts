import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const guildSettingsRepository = {
  // ── Widgets ──
  async findWidget(guildId: string) {
    const [widget] = await db
      .select()
      .from(schema.guildWidgets)
      .where(eq(schema.guildWidgets.guildId, guildId))
      .limit(1);
    return widget ?? null;
  },
  async upsertWidget(guildId: string, data: { enabled?: boolean; channelId?: string | null }) {
    const existing = await this.findWidget(guildId);
    if (existing) {
      await db
        .update(schema.guildWidgets)
        .set({
          enabled: data.enabled ?? existing.enabled,
          channelId: data.channelId !== undefined ? data.channelId : existing.channelId,
        })
        .where(eq(schema.guildWidgets.guildId, guildId));
    } else {
      await db.insert(schema.guildWidgets).values({
        guildId,
        enabled: data.enabled ?? false,
        channelId: data.channelId ?? null,
      });
    }
    return this.findWidget(guildId);
  },

  // ── Welcome Screen ──
  async findWelcomeScreen(guildId: string) {
    const [screen] = await db
      .select()
      .from(schema.guildWelcomeScreens)
      .where(eq(schema.guildWelcomeScreens.guildId, guildId))
      .limit(1);
    return screen ?? null;
  },
  async upsertWelcomeScreen(
    guildId: string,
    data: { enabled?: boolean; description?: string | null; welcomeChannels?: any[] },
  ) {
    const existing = await this.findWelcomeScreen(guildId);
    if (existing) {
      await db
        .update(schema.guildWelcomeScreens)
        .set({
          enabled: data.enabled ?? existing.enabled,
          description: data.description !== undefined ? data.description : existing.description,
          welcomeChannels: data.welcomeChannels ?? existing.welcomeChannels,
          updatedAt: new Date(),
        })
        .where(eq(schema.guildWelcomeScreens.guildId, guildId));
    } else {
      await db.insert(schema.guildWelcomeScreens).values({
        guildId,
        enabled: data.enabled ?? false,
        description: data.description ?? null,
        welcomeChannels: data.welcomeChannels ?? [],
      });
    }
    return this.findWelcomeScreen(guildId);
  },

  // ── Onboarding ──
  async findOnboarding(guildId: string) {
    const [onboarding] = await db
      .select()
      .from(schema.guildOnboarding)
      .where(eq(schema.guildOnboarding.guildId, guildId))
      .limit(1);
    return onboarding ?? null;
  },
  async upsertOnboarding(
    guildId: string,
    data: { prompts?: any[]; defaultChannelIds?: string[]; enabled?: boolean; mode?: number },
  ) {
    const existing = await this.findOnboarding(guildId);
    if (existing) {
      await db
        .update(schema.guildOnboarding)
        .set({
          prompts: data.prompts ?? existing.prompts,
          defaultChannelIds: data.defaultChannelIds ?? existing.defaultChannelIds,
          enabled: data.enabled ?? existing.enabled,
          mode: data.mode ?? existing.mode,
          updatedAt: new Date(),
        })
        .where(eq(schema.guildOnboarding.guildId, guildId));
    } else {
      await db.insert(schema.guildOnboarding).values({
        guildId,
        prompts: data.prompts ?? [],
        defaultChannelIds: data.defaultChannelIds ?? [],
        enabled: data.enabled ?? false,
        mode: data.mode ?? 0,
      });
    }
    return this.findOnboarding(guildId);
  },

  // ── Preview ──
  async findPreview(guildId: string) {
    const [preview] = await db
      .select()
      .from(schema.guildPreviews)
      .where(eq(schema.guildPreviews.guildId, guildId))
      .limit(1);
    return preview ?? null;
  },
};
