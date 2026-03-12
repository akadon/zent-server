import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { interactionRepository } from "../repositories/interaction.repository.js";
import { messageRepository } from "../repositories/message.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { redis } from "../config/redis.js";
import crypto from "crypto";

// Redis key for tracking which message was the original response to an interaction
const INTERACTION_MSG_PREFIX = "interaction_msg:";

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

// ── Interaction Message Creation ──

async function createInteractionMessage(
  channelId: string,
  applicationId: string,
  data: {
    content?: string;
    tts?: boolean;
    flags?: number;
  }
): Promise<Record<string, any>> {
  const id = generateSnowflake();
  const content = data.content ?? "";
  const tts = data.tts ?? false;
  const mentionEveryone = content.includes("@everyone") || content.includes("@here");
  const createdAt = new Date();

  // Use the application (bot) as the author
  const author = await userRepository.findPublicById(applicationId);
  const authorSnapshot = author
    ? { id: author.id, username: author.username, displayName: author.displayName, avatar: author.avatar }
    : { id: applicationId, username: "Application", displayName: null, avatar: null };

  // Message type 20 = CHAT_INPUT_COMMAND (interaction response)
  await Promise.all([
    messageRepository.create({
      id,
      channelId,
      authorId: applicationId,
      content,
      type: 20,
      tts,
      nonce: null,
      referencedMessageId: null,
      mentionEveryone,
      createdAt,
      authorSnapshot,
    }),
    messageRepository.updateLastMessageId(channelId, id),
  ]);

  return {
    id,
    channelId,
    author: author ?? {
      id: applicationId,
      username: "Application",
      displayName: null,
      avatar: null,
      status: "offline",
    },
    content,
    type: 20,
    flags: data.flags ?? 0,
    tts,
    mentionEveryone,
    pinned: false,
    editedTimestamp: null,
    referencedMessageId: null,
    referencedMessage: null,
    webhookId: null,
    attachments: [],
    embeds: [],
    reactions: [],
    createdAt: createdAt.toISOString(),
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

  if (!interaction.channelId) {
    throw new ApiError(400, "Interaction has no channel to send followup to");
  }

  // Create a real message in the channel as the application (bot)
  return await createInteractionMessage(interaction.channelId, interaction.applicationId, data);
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

  // Look up the original response message ID from Redis
  const messageId = await redis.get(`${INTERACTION_MSG_PREFIX}${interaction.id}`);
  if (!messageId) {
    throw new ApiError(404, "Original interaction response message not found");
  }

  // Update the message content
  const updateData: Record<string, any> = {};
  if (data.content !== undefined) updateData.content = data.content;
  if (data.content !== undefined) updateData.editedTimestamp = new Date();
  await messageRepository.update(messageId, updateData);

  // Return the updated message
  const message = await messageRepository.findById(messageId);
  if (!message) {
    throw new ApiError(404, "Message not found after update");
  }

  const author = await userRepository.findPublicById(message.authorId);
  const resolvedAuthor = author ?? {
    id: message.authorId,
    username: "Deleted User",
    displayName: null,
    avatar: null,
    status: "offline",
  };

  return {
    id: message.id,
    channelId: message.channelId,
    author: resolvedAuthor,
    content: message.content,
    type: message.type,
    flags: message.flags,
    tts: message.tts,
    mentionEveryone: message.mentionEveryone,
    pinned: message.pinned,
    editedTimestamp: message.editedTimestamp?.toISOString() ?? null,
    attachments: [],
    embeds: [],
    reactions: [],
    createdAt: message.createdAt.toISOString(),
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

  // Look up the original response message ID from Redis
  const messageId = await redis.get(`${INTERACTION_MSG_PREFIX}${interaction.id}`);
  if (!messageId) {
    throw new ApiError(404, "Original interaction response message not found");
  }

  // Delete the message
  await messageRepository.delete(messageId);

  // Clean up the Redis mapping
  await redis.del(`${INTERACTION_MSG_PREFIX}${interaction.id}`);
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

    case InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE: {
      if (!interaction.channelId) {
        throw new ApiError(400, "Interaction has no channel to respond in");
      }

      // Create a real message in the channel
      const message = await createInteractionMessage(
        interaction.channelId,
        interaction.applicationId,
        {
          content: data?.content,
          tts: data?.tts,
          flags: data?.flags,
        }
      );

      // Store the message ID so we can edit/delete it later
      await redis.setex(
        `${INTERACTION_MSG_PREFIX}${interaction.id}`,
        INTERACTION_TOKEN_TTL / 1000,
        message.id
      );

      return {
        type: responseType,
        data: message,
      };
    }

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
