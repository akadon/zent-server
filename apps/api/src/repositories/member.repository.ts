import { eq, and, inArray, or, like } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const memberRepository = {
  async findByUserAndGuild(userId: string, guildId: string) {
    const [member] = await db.select().from(schema.members)
      .where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)))
      .limit(1);
    return member ?? null;
  },
  async exists(userId: string, guildId: string) {
    const [member] = await db.select({ userId: schema.members.userId }).from(schema.members)
      .where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)))
      .limit(1);
    return !!member;
  },
  async findByGuildId(guildId: string) {
    return db.select().from(schema.members).where(eq(schema.members.guildId, guildId));
  },
  async findByGuildIds(guildIds: string[]) {
    if (guildIds.length === 0) return [];
    return db.select().from(schema.members).where(inArray(schema.members.guildId, guildIds));
  },
  async findGuildIdsByUserId(userId: string) {
    return db.select({ guildId: schema.members.guildId }).from(schema.members).where(eq(schema.members.userId, userId));
  },
  async create(data: { userId: string; guildId: string; nickname?: string }) {
    await db.insert(schema.members).values(data);
  },
  async createInTx(tx: any, data: { userId: string; guildId: string }) {
    await tx.insert(schema.members).values(data);
  },
  async delete(userId: string, guildId: string) {
    await db.delete(schema.members).where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)));
  },
  async update(userId: string, guildId: string, data: Record<string, any>) {
    await db.update(schema.members).set(data).where(and(eq(schema.members.userId, userId), eq(schema.members.guildId, guildId)));
  },
  // Bans
  async findBan(userId: string, guildId: string) {
    const [ban] = await db.select().from(schema.bans)
      .where(and(eq(schema.bans.userId, userId), eq(schema.bans.guildId, guildId)))
      .limit(1);
    return ban ?? null;
  },
  async createBan(data: { userId: string; guildId: string; bannedBy?: string; reason?: string | null }) {
    await db.insert(schema.bans).values(data);
  },
  async deleteBan(userId: string, guildId: string) {
    await db.delete(schema.bans).where(and(eq(schema.bans.userId, userId), eq(schema.bans.guildId, guildId)));
  },
  // Member roles
  async getMemberRoleIds(userId: string, guildId: string) {
    return db.select({ roleId: schema.memberRoles.roleId }).from(schema.memberRoles)
      .where(and(eq(schema.memberRoles.userId, userId), eq(schema.memberRoles.guildId, guildId)));
  },
  async deleteMemberRoles(userId: string, guildId: string) {
    await db.delete(schema.memberRoles).where(and(eq(schema.memberRoles.userId, userId), eq(schema.memberRoles.guildId, guildId)));
  },
  async findByGuildIdWithLimit(guildId: string, limit: number) {
    return db.select().from(schema.members).where(eq(schema.members.guildId, guildId)).limit(limit);
  },
  async findAllMemberRolesByGuildId(guildId: string, limit: number = 10000) {
    return db.select({ userId: schema.memberRoles.userId, roleId: schema.memberRoles.roleId }).from(schema.memberRoles)
      .where(eq(schema.memberRoles.guildId, guildId))
      .limit(limit);
  },
  async findMembershipsByUserId(userId: string) {
    return db.select({
      guildId: schema.members.guildId,
      nickname: schema.members.nickname,
      joinedAt: schema.members.joinedAt,
    }).from(schema.members).where(eq(schema.members.userId, userId));
  },
  async findBansByGuildId(guildId: string) {
    return db.select().from(schema.bans).where(eq(schema.bans.guildId, guildId));
  },
  async findWithUserByGuildAndUserIds(guildId: string, userIds: string[]) {
    if (userIds.length === 0) return [];
    return db.select({
      member: schema.members,
      user: {
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
        status: schema.users.status,
      },
    })
      .from(schema.members)
      .leftJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .where(and(eq(schema.members.guildId, guildId), inArray(schema.members.userId, userIds)));
  },
  async searchByGuildAndQuery(guildId: string, query: string, limit: number) {
    const queryPattern = `${query}%`;
    return db.select({
      member: schema.members,
      user: {
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatar: schema.users.avatar,
        status: schema.users.status,
      },
    })
      .from(schema.members)
      .leftJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .where(and(
        eq(schema.members.guildId, guildId),
        query === "" ? undefined : or(
          like(schema.users.username, queryPattern),
          like(schema.members.nickname, queryPattern),
        ),
      ))
      .limit(limit);
  },
  async getMemberRolesByGuildAndUserIds(guildId: string, userIds: string[]) {
    if (userIds.length === 0) return [];
    return db.select({ userId: schema.memberRoles.userId, roleId: schema.memberRoles.roleId })
      .from(schema.memberRoles)
      .where(and(eq(schema.memberRoles.guildId, guildId), inArray(schema.memberRoles.userId, userIds)));
  },
  transaction: db.transaction.bind(db),
};
