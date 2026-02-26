import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const applicationRepository = {
  async findById(id: string) {
    const [app] = await db.select().from(schema.applications).where(eq(schema.applications.id, id)).limit(1);
    return app ?? null;
  },
  async findByUserId(userId: string) {
    return db.select().from(schema.applications).where(eq(schema.applications.ownerId, userId));
  },
  async create(data: {
    id: string;
    name: string;
    icon?: string | null;
    description?: string;
    ownerId: string;
    botUserId?: string | null;
    verifyKey: string;
    botPublic?: boolean;
    botRequireCodeGrant?: boolean;
    flags?: number;
    interactionsEndpointUrl?: string | null;
  }) {
    await db.insert(schema.applications).values(data);
    return (await db.select().from(schema.applications).where(eq(schema.applications.id, data.id)).limit(1))[0]!;
  },
  async update(id: string, data: Partial<{
    name: string;
    icon: string | null;
    description: string;
    botPublic: boolean;
    botRequireCodeGrant: boolean;
    flags: number;
    interactionsEndpointUrl: string | null;
  }>) {
    await db.update(schema.applications).set(data).where(eq(schema.applications.id, id));
    return (await db.select().from(schema.applications).where(eq(schema.applications.id, id)).limit(1))[0]!;
  },
  async delete(id: string) {
    await db.delete(schema.applications).where(eq(schema.applications.id, id));
  },
  async findCommands(applicationId: string, guildId?: string) {
    if (guildId) {
      return db
        .select()
        .from(schema.applicationCommands)
        .where(
          and(
            eq(schema.applicationCommands.applicationId, applicationId),
            eq(schema.applicationCommands.guildId, guildId),
          ),
        );
    }
    return db
      .select()
      .from(schema.applicationCommands)
      .where(eq(schema.applicationCommands.applicationId, applicationId));
  },
  async findGlobalCommands(applicationId: string) {
    return db
      .select()
      .from(schema.applicationCommands)
      .where(
        and(
          eq(schema.applicationCommands.applicationId, applicationId),
          isNull(schema.applicationCommands.guildId),
        ),
      );
  },
  async findCommandById(applicationId: string, commandId: string) {
    const [cmd] = await db
      .select()
      .from(schema.applicationCommands)
      .where(
        and(
          eq(schema.applicationCommands.applicationId, applicationId),
          eq(schema.applicationCommands.id, commandId),
        ),
      )
      .limit(1);
    return cmd ?? null;
  },
  async deleteGlobalCommands(applicationId: string) {
    await db
      .delete(schema.applicationCommands)
      .where(
        and(
          eq(schema.applicationCommands.applicationId, applicationId),
          isNull(schema.applicationCommands.guildId),
        ),
      );
  },
  async deleteGuildCommands(applicationId: string, guildId: string) {
    await db
      .delete(schema.applicationCommands)
      .where(
        and(
          eq(schema.applicationCommands.applicationId, applicationId),
          eq(schema.applicationCommands.guildId, guildId),
        ),
      );
  },
  async createCommand(data: {
    id: string;
    applicationId: string;
    guildId?: string | null;
    name: string;
    description: string;
    type?: number;
    options?: unknown;
    defaultMemberPermissions?: string | null;
    dmPermission?: boolean;
    nsfw?: boolean;
    version: string;
  }) {
    await db.insert(schema.applicationCommands).values(data);
    return (await db.select().from(schema.applicationCommands).where(eq(schema.applicationCommands.id, data.id)).limit(1))[0]!;
  },
  async updateCommand(id: string, data: Partial<{
    name: string;
    description: string;
    options: unknown;
    defaultMemberPermissions: string | null;
    dmPermission: boolean;
    nsfw: boolean;
    version: string;
  }>) {
    await db.update(schema.applicationCommands).set(data).where(eq(schema.applicationCommands.id, id));
    return (await db.select().from(schema.applicationCommands).where(eq(schema.applicationCommands.id, id)).limit(1))[0]!;
  },
  async deleteCommand(id: string) {
    await db.delete(schema.applicationCommands).where(eq(schema.applicationCommands.id, id));
  },
};
