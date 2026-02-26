import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { interactionRepository } from "../repositories/interaction.repository.js";
import crypto from "crypto";

export interface Interaction {
  id: string;
  applicationId: string;
  type: InteractionType;
  guildId: string | null;
  channelId: string | null;
  userId: string;
  token: string;
  data: any;
  version: number;
  createdAt: Date;
  respondedAt: Date | null;
}

export enum InteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5,
}

export enum InteractionResponseType {
  PONG = 1,
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  DEFERRED_UPDATE_MESSAGE = 6,
  UPDATE_MESSAGE = 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8,
  MODAL = 9,
  PREMIUM_REQUIRED = 10,
}

// Interaction token TTL (15 minutes)
const INTERACTION_TOKEN_TTL = 15 * 60 * 1000;

// ── Interaction Creation ──

export async function createInteraction(
  applicationId: string,
  type: InteractionType,
  userId: string,
  data: {
    guildId?: string;
    channelId?: string;
    data?: any;
  }
): Promise<Interaction> {
  const id = generateSnowflake();
  const token = crypto.randomBytes(32).toString("hex");

  const interaction = await interactionRepository.create({
    id,
    applicationId,
    type,
    guildId: data.guildId ?? null,
    channelId: data.channelId ?? null,
    userId,
    token,
    data: data.data ?? null,
    version: 1,
  });

  if (!interaction) {
    throw new ApiError(500, "Failed to create interaction");
  }

  return interaction;
}

export async function getInteraction(interactionId: string): Promise<Interaction | null> {
  return interactionRepository.findById(interactionId);
}

export async function getInteractionByToken(token: string): Promise<Interaction | null> {
  const interaction = await interactionRepository.findByToken(token);

  if (!interaction) {
    return null;
  }

  // Check if token is expired
  const createdAt = new Date(interaction.createdAt).getTime();
  if (Date.now() - createdAt > INTERACTION_TOKEN_TTL) {
    return null;
  }

  return interaction;
}

export async function markInteractionResponded(interactionId: string): Promise<void> {
  await interactionRepository.markResponded(interactionId);
}

// ── Command Resolution ──

export async function resolveCommand(
  applicationId: string,
  guildId: string | null,
  commandName: string
): Promise<any | null> {
  // First check guild commands
  if (guildId) {
    const guildCommand = await interactionRepository.findGuildCommand(applicationId, guildId, commandName);
    if (guildCommand) {
      return guildCommand;
    }
  }

  // Fall back to global commands
  return interactionRepository.findGlobalCommand(applicationId, commandName);
}

// ── Interaction Response Helpers ──

export function createPongResponse() {
  return { type: InteractionResponseType.PONG };
}

export function createMessageResponse(data: {
  content?: string;
  embeds?: any[];
  components?: any[];
  flags?: number;
  tts?: boolean;
}) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data,
  };
}

export function createDeferredResponse(ephemeral = false) {
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: ephemeral ? { flags: 64 } : undefined,
  };
}

export function createUpdateResponse(data: {
  content?: string;
  embeds?: any[];
  components?: any[];
}) {
  return {
    type: InteractionResponseType.UPDATE_MESSAGE,
    data,
  };
}

export function createAutocompleteResponse(choices: Array<{ name: string; value: string | number }>) {
  return {
    type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
    data: { choices },
  };
}

export function createModalResponse(data: {
  customId: string;
  title: string;
  components: any[];
}) {
  return {
    type: InteractionResponseType.MODAL,
    data,
  };
}

// ── Webhook Execution for Followup ──

export async function sendFollowup(
  applicationId: string,
  interactionToken: string,
  data: {
    content?: string;
    embeds?: any[];
    components?: any[];
    flags?: number;
    tts?: boolean;
  }
): Promise<any> {
  // Verify interaction exists and token is valid
  const interaction = await getInteractionByToken(interactionToken);
  if (!interaction) {
    throw new ApiError(404, "Unknown interaction or token expired");
  }

  // In a real implementation, this would create a message via the webhook
  // For now, we return the data that would be sent
  return {
    ...data,
    interactionId: interaction.id,
    applicationId,
  };
}

export async function editOriginalResponse(
  applicationId: string,
  interactionToken: string,
  data: {
    content?: string;
    embeds?: any[];
    components?: any[];
  }
): Promise<any> {
  const interaction = await getInteractionByToken(interactionToken);
  if (!interaction) {
    throw new ApiError(404, "Unknown interaction or token expired");
  }

  return {
    ...data,
    interactionId: interaction.id,
    applicationId,
  };
}

export async function deleteOriginalResponse(
  applicationId: string,
  interactionToken: string
): Promise<void> {
  const interaction = await getInteractionByToken(interactionToken);
  if (!interaction) {
    throw new ApiError(404, "Unknown interaction or token expired");
  }

  // In a real implementation, delete the original response message
}

// ── Interaction Response Callback ──

export async function respondToInteraction(
  interactionId: string,
  interactionToken: string,
  responseType: number,
  data?: {
    tts?: boolean;
    content?: string;
    embeds?: any[];
    allowed_mentions?: any;
    flags?: number;
    components?: any[];
    attachments?: any[];
    choices?: Array<{ name: string; value: string | number }>;
    title?: string;
    custom_id?: string;
  }
): Promise<any | null> {
  // Verify interaction exists and token matches
  const interaction = await getInteractionByToken(interactionToken);
  if (!interaction || interaction.id !== interactionId) {
    throw new ApiError(404, "Unknown interaction");
  }

  // Mark as responded
  await markInteractionResponded(interactionId);

  // Handle different response types
  switch (responseType) {
    case InteractionResponseType.PONG:
      return null; // No body for PONG

    case InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE:
      // In a full implementation, this would create a message in the channel
      return {
        type: responseType,
        data: {
          tts: data?.tts,
          content: data?.content,
          embeds: data?.embeds,
          allowed_mentions: data?.allowed_mentions,
          flags: data?.flags,
          components: data?.components,
          attachments: data?.attachments,
        },
      };

    case InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE:
      // Acknowledge and will send response later via followup
      return null;

    case InteractionResponseType.DEFERRED_UPDATE_MESSAGE:
      // Acknowledge component interaction, will update later
      return null;

    case InteractionResponseType.UPDATE_MESSAGE:
      // Update the message the component was attached to
      return {
        type: responseType,
        data: {
          content: data?.content,
          embeds: data?.embeds,
          components: data?.components,
          attachments: data?.attachments,
        },
      };

    case InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT:
      // Return autocomplete choices
      return {
        type: responseType,
        data: {
          choices: data?.choices ?? [],
        },
      };

    case InteractionResponseType.MODAL:
      // Show a modal dialog
      return {
        type: responseType,
        data: {
          custom_id: data?.custom_id,
          title: data?.title,
          components: data?.components,
        },
      };

    case InteractionResponseType.PREMIUM_REQUIRED:
      // Indicate premium is required
      return { type: responseType };

    default:
      throw new ApiError(400, `Invalid interaction response type: ${responseType}`);
  }
}
