import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import crypto from "crypto";

export interface Application {
  id: string;
  name: string;
  icon: string | null;
  description: string;
  botPublic: boolean;
  botRequireCodeGrant: boolean;
  ownerId: string;
  botUserId: string | null;
  verifyKey: string;
  flags: number;
  interactionsEndpointUrl: string | null;
  createdAt: Date;
}

export interface ApplicationCommand {
  id: string;
  applicationId: string;
  guildId: string | null;
  name: string;
  description: string;
  type: number;
  options: any[] | null;
  defaultMemberPermissions: string | null;
  dmPermission: boolean;
  nsfw: boolean;
  version: string;
}

// ── Application Management ──

export async function createApplication(
  ownerId: string,
  name: string
): Promise<Application> {
  const id = generateSnowflake();
  const verifyKey = crypto.randomBytes(32).toString("hex");

  await db
    .insert(schema.applications)
    .values({
      id,
      name,
      description: "",
      ownerId,
      verifyKey,
      flags: 0,
    });

  const [app] = await db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.id, id))
    .limit(1);

  if (!app) {
    throw new ApiError(500, "Failed to create application");
  }

  return app;
}

export async function getApplication(appId: string): Promise<Application | null> {
  const [app] = await db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.id, appId))
    .limit(1);

  return app ?? null;
}

export async function getUserApplications(userId: string): Promise<Application[]> {
  return db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.ownerId, userId));
}

export async function updateApplication(
  appId: string,
  ownerId: string,
  data: Partial<{
    name: string;
    description: string;
    icon: string | null;
    botPublic: boolean;
    botRequireCodeGrant: boolean;
    interactionsEndpointUrl: string | null;
  }>
): Promise<Application> {
  await db
    .update(schema.applications)
    .set(data)
    .where(
      and(
        eq(schema.applications.id, appId),
        eq(schema.applications.ownerId, ownerId)
      )
    );

  const [app] = await db
    .select()
    .from(schema.applications)
    .where(
      and(
        eq(schema.applications.id, appId),
        eq(schema.applications.ownerId, ownerId)
      )
    )
    .limit(1);

  if (!app) {
    throw new ApiError(404, "Application not found or you don't own it");
  }

  return app;
}

export async function deleteApplication(appId: string, ownerId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.applications)
    .where(
      and(
        eq(schema.applications.id, appId),
        eq(schema.applications.ownerId, ownerId)
      )
    )
    .limit(1);

  if (!existing) {
    throw new ApiError(404, "Application not found or you don't own it");
  }

  await db
    .delete(schema.applications)
    .where(
      and(
        eq(schema.applications.id, appId),
        eq(schema.applications.ownerId, ownerId)
      )
    );
}

// ── Application Commands (Slash Commands) ──

export async function createCommand(
  applicationId: string,
  guildId: string | null,
  data: {
    name: string;
    description: string;
    type?: number;
    options?: any[];
    defaultMemberPermissions?: string;
    dmPermission?: boolean;
    nsfw?: boolean;
  }
): Promise<ApplicationCommand> {
  // Validate command name (1-32 lowercase alphanumeric with dashes)
  if (!/^[\w-]{1,32}$/.test(data.name) || data.name !== data.name.toLowerCase()) {
    throw new ApiError(400, "Invalid command name");
  }

  const id = generateSnowflake();
  const version = generateSnowflake();

  await db
    .insert(schema.applicationCommands)
    .values({
      id,
      applicationId,
      guildId,
      name: data.name,
      description: data.description,
      type: data.type ?? 1,
      options: data.options ?? null,
      defaultMemberPermissions: data.defaultMemberPermissions ?? null,
      dmPermission: data.dmPermission ?? true,
      nsfw: data.nsfw ?? false,
      version,
    });

  const [command] = await db
    .select()
    .from(schema.applicationCommands)
    .where(eq(schema.applicationCommands.id, id))
    .limit(1);

  if (!command) {
    throw new ApiError(500, "Failed to create command");
  }

  return command;
}

export async function getGlobalCommands(applicationId: string): Promise<ApplicationCommand[]> {
  return db
    .select()
    .from(schema.applicationCommands)
    .where(
      and(
        eq(schema.applicationCommands.applicationId, applicationId),
        isNull(schema.applicationCommands.guildId)
      )
    );
}

export async function getGuildCommands(
  applicationId: string,
  guildId: string
): Promise<ApplicationCommand[]> {
  return db
    .select()
    .from(schema.applicationCommands)
    .where(
      and(
        eq(schema.applicationCommands.applicationId, applicationId),
        eq(schema.applicationCommands.guildId, guildId)
      )
    );
}

export async function getCommand(
  applicationId: string,
  commandId: string
): Promise<ApplicationCommand | null> {
  const [command] = await db
    .select()
    .from(schema.applicationCommands)
    .where(
      and(
        eq(schema.applicationCommands.applicationId, applicationId),
        eq(schema.applicationCommands.id, commandId)
      )
    )
    .limit(1);

  return command ?? null;
}

export async function updateCommand(
  applicationId: string,
  commandId: string,
  data: Partial<{
    name: string;
    description: string;
    options: any[];
    defaultMemberPermissions: string | null;
    dmPermission: boolean;
    nsfw: boolean;
  }>
): Promise<ApplicationCommand> {
  if (data.name && (!/^[\w-]{1,32}$/.test(data.name) || data.name !== data.name.toLowerCase())) {
    throw new ApiError(400, "Invalid command name");
  }

  const version = generateSnowflake();

  await db
    .update(schema.applicationCommands)
    .set({ ...data, version })
    .where(
      and(
        eq(schema.applicationCommands.applicationId, applicationId),
        eq(schema.applicationCommands.id, commandId)
      )
    );

  const [command] = await db
    .select()
    .from(schema.applicationCommands)
    .where(
      and(
        eq(schema.applicationCommands.applicationId, applicationId),
        eq(schema.applicationCommands.id, commandId)
      )
    )
    .limit(1);

  if (!command) {
    throw new ApiError(404, "Command not found");
  }

  return command;
}

export async function deleteCommand(
  applicationId: string,
  commandId: string
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.applicationCommands)
    .where(
      and(
        eq(schema.applicationCommands.applicationId, applicationId),
        eq(schema.applicationCommands.id, commandId)
      )
    )
    .limit(1);

  if (!existing) {
    throw new ApiError(404, "Command not found");
  }

  await db
    .delete(schema.applicationCommands)
    .where(
      and(
        eq(schema.applicationCommands.applicationId, applicationId),
        eq(schema.applicationCommands.id, commandId)
      )
    );
}

export async function bulkOverwriteGlobalCommands(
  applicationId: string,
  commands: Array<{
    name: string;
    description: string;
    type?: number;
    options?: any[];
    defaultMemberPermissions?: string;
    dmPermission?: boolean;
    nsfw?: boolean;
  }>
): Promise<ApplicationCommand[]> {
  // Delete all existing global commands
  await db
    .delete(schema.applicationCommands)
    .where(
      and(
        eq(schema.applicationCommands.applicationId, applicationId),
        isNull(schema.applicationCommands.guildId)
      )
    );

  // Insert new commands
  const results: ApplicationCommand[] = [];
  for (const cmd of commands) {
    const command = await createCommand(applicationId, null, cmd);
    results.push(command);
  }

  return results;
}

export async function bulkOverwriteGuildCommands(
  applicationId: string,
  guildId: string,
  commands: Array<{
    name: string;
    description: string;
    type?: number;
    options?: any[];
    defaultMemberPermissions?: string;
    dmPermission?: boolean;
    nsfw?: boolean;
  }>
): Promise<ApplicationCommand[]> {
  // Delete all existing guild commands
  await db
    .delete(schema.applicationCommands)
    .where(
      and(
        eq(schema.applicationCommands.applicationId, applicationId),
        eq(schema.applicationCommands.guildId, guildId)
      )
    );

  // Insert new commands
  const results: ApplicationCommand[] = [];
  for (const cmd of commands) {
    const command = await createCommand(applicationId, guildId, cmd);
    results.push(command);
  }

  return results;
}
