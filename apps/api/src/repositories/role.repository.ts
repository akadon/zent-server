import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const roleRepository = {
  async findById(id: string) {
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id)).limit(1);
    return role ?? null;
  },
  async findByGuildId(guildId: string) {
    return db.select().from(schema.roles).where(eq(schema.roles.guildId, guildId));
  },
  async findEveryoneRole(guildId: string) {
    const [role] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.guildId, guildId), eq(schema.roles.name, "@everyone")))
      .limit(1);
    return role ?? null;
  },
  async findByGuildIds(guildIds: string[]) {
    if (guildIds.length === 0) return [];
    return db.select().from(schema.roles).where(inArray(schema.roles.guildId, guildIds));
  },
  async create(data: { id: string; guildId: string; name: string; permissions?: string; position?: number; color?: number; hoist?: boolean; mentionable?: boolean }) {
    await db.insert(schema.roles).values(data);
    const [created] = await db.select().from(schema.roles).where(eq(schema.roles.id, data.id)).limit(1);
    return created!;
  },
  async createInTx(tx: any, data: any) {
    await tx.insert(schema.roles).values(data);
  },
  async update(id: string, data: Record<string, any>) {
    await db.update(schema.roles).set(data).where(eq(schema.roles.id, id));
    const [updated] = await db.select().from(schema.roles).where(eq(schema.roles.id, id)).limit(1);
    return updated!;
  },
  async delete(id: string) {
    // Remove role from all members first
    await db.delete(schema.memberRoles).where(eq(schema.memberRoles.roleId, id));
    await db.delete(schema.roles).where(eq(schema.roles.id, id));
  },
  async addToMember(userId: string, guildId: string, roleId: string) {
    await db.insert(schema.memberRoles).values({ userId, guildId, roleId }).onConflictDoNothing();
  },
  async removeFromMember(userId: string, guildId: string, roleId: string) {
    await db.delete(schema.memberRoles).where(
      and(eq(schema.memberRoles.userId, userId), eq(schema.memberRoles.guildId, guildId), eq(schema.memberRoles.roleId, roleId))
    );
  },
  async getMemberRoleIds(userId: string, guildId: string) {
    const rows = await db.select({ roleId: schema.memberRoles.roleId }).from(schema.memberRoles)
      .where(and(eq(schema.memberRoles.userId, userId), eq(schema.memberRoles.guildId, guildId)));
    return rows.map(r => r.roleId);
  },
};
