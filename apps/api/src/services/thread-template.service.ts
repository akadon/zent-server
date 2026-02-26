import { generateSnowflake } from "@yxc/snowflake";
import { ApiError } from "./auth.service.js";
import { threadTemplateRepository } from "../repositories/thread-template.repository.js";

export async function createTemplate(
  channelId: string,
  guildId: string,
  name: string,
  content: string,
  createdBy: string
) {
  const id = generateSnowflake();
  const template = await threadTemplateRepository.create({ id, channelId, guildId, name, content, createdBy });

  return {
    ...template,
    createdAt: template.createdAt.toISOString(),
  };
}

export async function getTemplates(channelId: string) {
  const templates = await threadTemplateRepository.findByChannelId(channelId);
  return templates.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function deleteTemplate(templateId: string, userId: string) {
  const template = await threadTemplateRepository.findById(templateId);
  if (!template) throw new ApiError(404, "Template not found");
  if (template.createdBy !== userId) throw new ApiError(403, "Not your template");
  await threadTemplateRepository.delete(templateId);
}
