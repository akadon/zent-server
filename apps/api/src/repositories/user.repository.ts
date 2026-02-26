import { eq, or, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const userRepository = {
  async findById(id: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return user ?? null;
  },
  async findByEmail(email: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    return user ?? null;
  },
  async findByUsername(username: string) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
    return user ?? null;
  },
  async findByEmailOrUsername(email: string, username: string) {
    const [existing] = await db.select().from(schema.users)
      .where(or(eq(schema.users.email, email), eq(schema.users.username, username)))
      .limit(1);
    return existing ?? null;
  },
  async create(data: { id: string; username: string; email: string; passwordHash: string }) {
    await db.insert(schema.users).values(data);
    return (await db.select().from(schema.users).where(eq(schema.users.id, data.id)).limit(1))[0]!;
  },
  async update(id: string, data: Record<string, any>) {
    await db.update(schema.users).set({ ...data, updatedAt: new Date() }).where(eq(schema.users.id, id));
    const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return updated!;
  },
  async delete(id: string) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  },
  async findPublicByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return db.select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      status: schema.users.status,
    }).from(schema.users).where(inArray(schema.users.id, ids));
  },
  async findPublicById(id: string) {
    const [user] = await db.select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      status: schema.users.status,
    }).from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return user ?? null;
  },
  async updatePresence(userId: string, status: string, customStatus: any) {
    await db.update(schema.users).set({
      status: status as any,
      customStatus,
      updatedAt: new Date(),
    }).where(eq(schema.users.id, userId));
  },
  async upsertActivities(userId: string, activities: any) {
    await db.insert(schema.userActivities).values({
      userId,
      activities,
      updatedAt: new Date(),
    }).onDuplicateKeyUpdate({
      set: { activities, updatedAt: new Date() },
    });
  },
  async deleteActivities(userId: string) {
    await db.delete(schema.userActivities).where(eq(schema.userActivities.userId, userId));
  },
};
