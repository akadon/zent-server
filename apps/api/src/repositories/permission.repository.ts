import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const permissionRepository = {
  async findOverwritesByChannelId(channelId: string) {
    return db
      .select()
      .from(schema.permissionOverwrites)
      .where(eq(schema.permissionOverwrites.channelId, channelId));
  },
  async setOverwrite(data: {
    channelId: string;
    targetId: string;
    targetType: number;
    allow: string;
    deny: string;
  }) {
    await db
      .insert(schema.permissionOverwrites)
      .values(data)
      .onDuplicateKeyUpdate({
        set: { allow: data.allow, deny: data.deny },
      });
  },
  async deleteOverwrite(channelId: string, targetId: string) {
    await db
      .delete(schema.permissionOverwrites)
      .where(
        and(
          eq(schema.permissionOverwrites.channelId, channelId),
          eq(schema.permissionOverwrites.targetId, targetId),
        ),
      );
  },
  async createOverwrite(data: {
    channelId: string;
    targetId: string;
    targetType: number | string;
    allow: string;
    deny: string;
  }) {
    await db.insert(schema.permissionOverwrites).values(data);
  },
  async findMemberRolesWithPermissions(userId: string, guildId: string) {
    return db
      .select({
        roleId: schema.memberRoles.roleId,
        permissions: schema.roles.permissions,
        position: schema.roles.position,
      })
      .from(schema.memberRoles)
      .innerJoin(schema.roles, eq(schema.memberRoles.roleId, schema.roles.id))
      .where(
        and(
          eq(schema.memberRoles.userId, userId),
          eq(schema.memberRoles.guildId, guildId),
        ),
      );
  },
};
