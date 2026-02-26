import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const recoveryKeyRepository = {
  async findByUserId(userId: string) {
    const [key] = await db
      .select()
      .from(schema.recoveryKeys)
      .where(eq(schema.recoveryKeys.userId, userId))
      .limit(1);
    return key ?? null;
  },
  async create(data: { id: string; userId: string; keyHash: string }) {
    await db.insert(schema.recoveryKeys).values(data);
  },
  async deleteByUserId(userId: string) {
    await db.delete(schema.recoveryKeys).where(eq(schema.recoveryKeys.userId, userId));
  },
};
