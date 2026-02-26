import { eq, and, or } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const relationshipRepository = {
  async findByUserAndTarget(userId: string, targetId: string) {
    const [rel] = await db
      .select()
      .from(schema.relationships)
      .where(and(eq(schema.relationships.userId, userId), eq(schema.relationships.targetId, targetId)))
      .limit(1);
    return rel ?? null;
  },
  async findByUserAndTargetWithType(userId: string, targetId: string, type: number) {
    const [rel] = await db
      .select()
      .from(schema.relationships)
      .where(and(
        eq(schema.relationships.userId, userId),
        eq(schema.relationships.targetId, targetId),
        eq(schema.relationships.type, type),
      ))
      .limit(1);
    return rel ?? null;
  },
  async findByUserId(userId: string) {
    return db
      .select()
      .from(schema.relationships)
      .where(or(eq(schema.relationships.userId, userId), eq(schema.relationships.targetId, userId)));
  },
  async findOutgoingByUserId(userId: string) {
    return db
      .select()
      .from(schema.relationships)
      .where(eq(schema.relationships.userId, userId));
  },
  async create(data: { userId: string; targetId: string; type: number }) {
    await db.insert(schema.relationships).values(data);
  },
  async upsert(userId: string, targetId: string, type: number) {
    await db
      .insert(schema.relationships)
      .values({ userId, targetId, type })
      .onConflictDoUpdate({
        target: [schema.relationships.userId, schema.relationships.targetId],
        set: { type },
      });
  },
  async delete(userId: string, targetId: string) {
    await db
      .delete(schema.relationships)
      .where(and(eq(schema.relationships.userId, userId), eq(schema.relationships.targetId, targetId)));
  },
  async deleteByUserAndTarget(userId: string, targetId: string) {
    await db
      .delete(schema.relationships)
      .where(
        or(
          and(eq(schema.relationships.userId, userId), eq(schema.relationships.targetId, targetId)),
          and(eq(schema.relationships.userId, targetId), eq(schema.relationships.targetId, userId)),
        ),
      );
  },
  async update(userId: string, targetId: string, data: { type: number }) {
    await db
      .update(schema.relationships)
      .set(data)
      .where(and(eq(schema.relationships.userId, userId), eq(schema.relationships.targetId, targetId)));
  },
  async acceptFriendRequest(userId: string, targetId: string, hasExisting: boolean) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.relationships)
        .set({ type: 1 })
        .where(and(eq(schema.relationships.userId, targetId), eq(schema.relationships.targetId, userId)));
      if (hasExisting) {
        await tx
          .update(schema.relationships)
          .set({ type: 1 })
          .where(and(eq(schema.relationships.userId, userId), eq(schema.relationships.targetId, targetId)));
      } else {
        await tx.insert(schema.relationships).values({ userId, targetId, type: 1 });
      }
    });
  },
  async sendFriendRequest(userId: string, targetId: string) {
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.relationships)
        .values({ userId, targetId, type: 4 })
        .onConflictDoUpdate({
          target: [schema.relationships.userId, schema.relationships.targetId],
          set: { type: 4 },
        });
      await tx
        .insert(schema.relationships)
        .values({ userId: targetId, targetId: userId, type: 3 })
        .onConflictDoUpdate({
          target: [schema.relationships.userId, schema.relationships.targetId],
          set: { type: 3 },
        });
    });
  },
  async removeBothSides(userId: string, targetId: string) {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.relationships)
        .where(and(eq(schema.relationships.userId, userId), eq(schema.relationships.targetId, targetId)));
      await tx
        .delete(schema.relationships)
        .where(and(eq(schema.relationships.userId, targetId), eq(schema.relationships.targetId, userId)));
    });
  },
  async blockUser(userId: string, targetId: string) {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.relationships)
        .where(and(eq(schema.relationships.userId, targetId), eq(schema.relationships.targetId, userId)));
      await tx
        .insert(schema.relationships)
        .values({ userId, targetId, type: 2 })
        .onConflictDoUpdate({
          target: [schema.relationships.userId, schema.relationships.targetId],
          set: { type: 2 },
        });
    });
  },
  async findFriendIds(userId: string) {
    return db
      .select({ targetId: schema.relationships.targetId })
      .from(schema.relationships)
      .where(and(eq(schema.relationships.userId, userId), eq(schema.relationships.type, 1)));
  },
  async acceptBothSides(userId: string, targetId: string) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.relationships)
        .set({ type: 1 })
        .where(and(eq(schema.relationships.userId, userId), eq(schema.relationships.targetId, targetId)));
      await tx
        .update(schema.relationships)
        .set({ type: 1 })
        .where(and(eq(schema.relationships.userId, targetId), eq(schema.relationships.targetId, userId)));
    });
  },
};
