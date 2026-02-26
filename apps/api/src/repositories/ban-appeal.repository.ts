import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const banAppealRepository = {
  async findById(id: string) {
    const [appeal] = await db.select().from(schema.banAppeals).where(eq(schema.banAppeals.id, id)).limit(1);
    return appeal ?? null;
  },
  async findPendingByUserAndGuild(userId: string, guildId: string) {
    const [appeal] = await db.select().from(schema.banAppeals)
      .where(and(
        eq(schema.banAppeals.guildId, guildId),
        eq(schema.banAppeals.userId, userId),
        eq(schema.banAppeals.status, "pending"),
      ))
      .limit(1);
    return appeal ?? null;
  },
  async findByGuildId(guildId: string) {
    return db.select().from(schema.banAppeals)
      .where(eq(schema.banAppeals.guildId, guildId))
      .orderBy(desc(schema.banAppeals.createdAt));
  },
  async create(data: { id: string; guildId: string; userId: string; reason: string }) {
    await db.insert(schema.banAppeals).values(data);
    const [created] = await db.select().from(schema.banAppeals).where(eq(schema.banAppeals.id, data.id)).limit(1);
    return created!;
  },
  async resolve(id: string, data: { status: string; moderatorId: string; moderatorReason: string | null }) {
    await db.update(schema.banAppeals).set({
      status: data.status as any,
      moderatorId: data.moderatorId,
      moderatorReason: data.moderatorReason,
      resolvedAt: new Date(),
    }).where(eq(schema.banAppeals.id, id));
    const [updated] = await db.select().from(schema.banAppeals).where(eq(schema.banAppeals.id, id)).limit(1);
    return updated!;
  },
};
