import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const interactionRepository = {
  async findById(id: string) {
    const [row] = await db.select().from(schema.interactions).where(eq(schema.interactions.id, id)).limit(1);
    return row ?? null;
  },
  async findByToken(token: string) {
    const [row] = await db.select().from(schema.interactions).where(eq(schema.interactions.token, token)).limit(1);
    return row ?? null;
  },
  async create(data: {
    id: string;
    applicationId: string;
    type: number;
    guildId: string | null;
    channelId: string | null;
    userId: string;
    token: string;
    data: any;
    version: number;
  }) {
    await db.insert(schema.interactions).values(data);
    const [created] = await db.select().from(schema.interactions).where(eq(schema.interactions.id, data.id)).limit(1);
    return created!;
  },
  async markResponded(id: string) {
    await db.update(schema.interactions).set({ respondedAt: new Date() }).where(eq(schema.interactions.id, id));
  },
  // Command resolution
  async findGuildCommand(applicationId: string, guildId: string, name: string) {
    const [cmd] = await db
      .select()
      .from(schema.applicationCommands)
      .where(
        and(
          eq(schema.applicationCommands.applicationId, applicationId),
          eq(schema.applicationCommands.guildId, guildId),
          eq(schema.applicationCommands.name, name),
        ),
      )
      .limit(1);
    return cmd ?? null;
  },
  async findGlobalCommand(applicationId: string, name: string) {
    const [cmd] = await db
      .select()
      .from(schema.applicationCommands)
      .where(
        and(
          eq(schema.applicationCommands.applicationId, applicationId),
          isNull(schema.applicationCommands.guildId),
          eq(schema.applicationCommands.name, name),
        ),
      )
      .limit(1);
    return cmd ?? null;
  },
};
