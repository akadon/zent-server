import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const inviteRepository = {
  async findByCode(code: string) {
    const [invite] = await db.select().from(schema.invites).where(eq(schema.invites.code, code)).limit(1);
    return invite ?? null;
  },
  async findByGuildId(guildId: string) {
    return db.select().from(schema.invites).where(eq(schema.invites.guildId, guildId));
  },
  async create(data: {
    code: string;
    guildId: string;
    channelId: string;
    inviterId?: string | null;
    maxUses?: number;
    maxAge?: number;
    temporary?: boolean;
    expiresAt?: Date | null;
  }) {
    await db.insert(schema.invites).values(data);
    return (await db.select().from(schema.invites).where(eq(schema.invites.code, data.code)).limit(1))[0]!;
  },
  async incrementUses(code: string) {
    const invite = await this.findByCode(code);
    if (!invite) return null;
    await db.update(schema.invites).set({ uses: invite.uses + 1 }).where(eq(schema.invites.code, code));
    return { ...invite, uses: invite.uses + 1 };
  },
  async delete(code: string) {
    await db.delete(schema.invites).where(eq(schema.invites.code, code));
  },
  async incrementUsesInTx(tx: any, code: string, currentUses: number) {
    await tx.update(schema.invites).set({ uses: currentUses + 1 }).where(eq(schema.invites.code, code));
  },
  transaction: db.transaction.bind(db),
};
