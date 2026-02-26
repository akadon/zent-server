import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { applicationRepository } from "../repositories/application.repository.js";
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

  const app = await applicationRepository.create({
    id,
    name,
    description: "",
    ownerId,
    verifyKey,
    flags: 0,
  });

  if (!app) {
    throw new ApiError(500, "Failed to create application");
  }

  return app;
}

export async function getApplication(appId: string): Promise<Application | null> {
  return applicationRepository.findById(appId);
}

export async function getUserApplications(userId: string): Promise<Application[]> {
  return applicationRepository.findByUserId(userId);
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
  const existing = await applicationRepository.findById(appId);
  if (!existing || existing.ownerId !== ownerId) {
    throw new ApiError(404, "Application not found or you don't own it");
  }

  return applicationRepository.update(appId, data);
}

export async function deleteApplication(appId: string, ownerId: string): Promise<void> {
  const existing = await applicationRepository.findById(appId);
  if (!existing || existing.ownerId !== ownerId) {
    throw new ApiError(404, "Application not found or you don't own it");
  }

  await applicationRepository.delete(appId);
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

  const command = await applicationRepository.createCommand({
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

  if (!command) {
    throw new ApiError(500, "Failed to create command");
  }

  return command;
}

export async function getGlobalCommands(applicationId: string): Promise<ApplicationCommand[]> {
  return applicationRepository.findGlobalCommands(applicationId);
}

export async function getGuildCommands(
  applicationId: string,
  guildId: string
): Promise<ApplicationCommand[]> {
  return applicationRepository.findCommands(applicationId, guildId);
}

export async function getCommand(
  applicationId: string,
  commandId: string
): Promise<ApplicationCommand | null> {
  return applicationRepository.findCommandById(applicationId, commandId);
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

  const command = await applicationRepository.updateCommand(commandId, { ...data, version });

  if (!command) {
    throw new ApiError(404, "Command not found");
  }

  return command;
}

export async function deleteCommand(
  applicationId: string,
  commandId: string
): Promise<void> {
  const existing = await applicationRepository.findCommandById(applicationId, commandId);

  if (!existing) {
    throw new ApiError(404, "Command not found");
  }

  await applicationRepository.deleteCommand(commandId);
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
  await applicationRepository.deleteGlobalCommands(applicationId);

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
  await applicationRepository.deleteGuildCommands(applicationId, guildId);

  // Insert new commands
  const results: ApplicationCommand[] = [];
  for (const cmd of commands) {
    const command = await createCommand(applicationId, guildId, cmd);
    results.push(command);
  }

  return results;
}
