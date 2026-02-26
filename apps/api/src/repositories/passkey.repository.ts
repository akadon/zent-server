import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const passkeyRepository = {
  async findByUserId(userId: string) {
    return db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.userId, userId));
  },
  async findByCredentialId(credentialId: string) {
    const [passkey] = await db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.credentialId, credentialId))
      .limit(1);
    return passkey ?? null;
  },
  async create(data: {
    id: string;
    userId: string;
    credentialId: string;
    publicKey: string;
    counter?: number;
    deviceType?: string | null;
    backedUp?: boolean;
    transports?: string[] | null;
    aaguid?: string | null;
  }) {
    await db.insert(schema.passkeyCredentials).values(data);
  },
  async updateCounter(id: string, counter: number) {
    await db
      .update(schema.passkeyCredentials)
      .set({ counter })
      .where(eq(schema.passkeyCredentials.id, id));
  },
  async incrementCounterByCredentialId(credentialId: string) {
    const current = await this.findByCredentialId(credentialId);
    if (current) {
      await db
        .update(schema.passkeyCredentials)
        .set({ counter: current.counter + 1 })
        .where(eq(schema.passkeyCredentials.credentialId, credentialId));
    }
  },
  async findById(id: string) {
    const [passkey] = await db
      .select()
      .from(schema.passkeyCredentials)
      .where(eq(schema.passkeyCredentials.id, id))
      .limit(1);
    return passkey ?? null;
  },
  async deleteByUserAndCredentialId(userId: string, credentialId: string) {
    await db
      .delete(schema.passkeyCredentials)
      .where(
        and(
          eq(schema.passkeyCredentials.userId, userId),
          eq(schema.passkeyCredentials.credentialId, credentialId),
        ),
      );
  },
  async delete(id: string) {
    await db.delete(schema.passkeyCredentials).where(eq(schema.passkeyCredentials.id, id));
  },
};
