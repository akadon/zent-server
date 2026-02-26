import { generateSnowflake } from "@yxc/snowflake";
import { messageComponentRepository } from "../repositories/message-component.repository.js";

export interface ComponentData {
  type: number;
  customId?: string;
  label?: string;
  style?: number;
  url?: string;
  disabled?: boolean;
  emoji?: { id?: string; name?: string; animated?: boolean };
  options?: Array<{
    label: string;
    value: string;
    description?: string;
    emoji?: { id?: string; name?: string; animated?: boolean };
    default?: boolean;
  }>;
  placeholder?: string;
  minValues?: number;
  maxValues?: number;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  components?: ComponentData[]; // For ActionRows
}

// Component Types
export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  USER_SELECT: 5,
  ROLE_SELECT: 6,
  MENTIONABLE_SELECT: 7,
  CHANNEL_SELECT: 8,
} as const;

// Button Styles
export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
  PREMIUM: 6,
} as const;

export async function createMessageComponents(
  messageId: string,
  components: ComponentData[]
): Promise<void> {
  // Validate: max 5 action rows
  if (components.length > 5) {
    throw new Error("Messages can have a maximum of 5 action rows");
  }

  for (const [rowIndex, row] of components.entries()) {
    if (!row) continue;

    if (row.type !== ComponentType.ACTION_ROW) {
      throw new Error("Top-level components must be action rows");
    }

    const rowId = generateSnowflake();

    // Insert ActionRow
    await messageComponentRepository.create({
      id: rowId,
      messageId,
      type: ComponentType.ACTION_ROW,
      position: rowIndex,
    });

    // Insert child components
    const children = row.components ?? [];

    // Validate: max 5 buttons per row, or 1 select menu
    const hasSelectMenu = children.some(c =>
      c && c.type >= ComponentType.STRING_SELECT && c.type <= ComponentType.CHANNEL_SELECT
    );

    if (hasSelectMenu && children.length > 1) {
      throw new Error("Action rows with select menus can only have one component");
    }

    if (!hasSelectMenu && children.length > 5) {
      throw new Error("Action rows can have a maximum of 5 buttons");
    }

    for (const [compIndex, comp] of children.entries()) {
      if (!comp) continue;

      await messageComponentRepository.create({
        id: generateSnowflake(),
        messageId,
        type: comp.type,
        customId: comp.customId,
        label: comp.label,
        style: comp.style,
        url: comp.url,
        disabled: comp.disabled ?? false,
        emoji: comp.emoji,
        options: comp.options,
        placeholder: comp.placeholder,
        minValues: comp.minValues,
        maxValues: comp.maxValues,
        minLength: comp.minLength,
        maxLength: comp.maxLength,
        required: comp.required,
        parentId: rowId,
        position: compIndex,
      });
    }
  }
}

export async function getMessageComponents(messageId: string): Promise<ComponentData[]> {
  const rows = await messageComponentRepository.findByMessageId(messageId);

  // Group by parent
  const actionRowsMap = new Map<string, ComponentData>();
  const childComponents = new Map<string, typeof rows>();

  for (const row of rows) {
    if (row.type === ComponentType.ACTION_ROW) {
      actionRowsMap.set(row.id, {
        type: row.type,
        components: [],
      });
    } else if (row.parentId) {
      if (!childComponents.has(row.parentId)) {
        childComponents.set(row.parentId, []);
      }
      childComponents.get(row.parentId)!.push(row);
    }
  }

  // Attach children to action rows
  for (const [rowId, actionRow] of actionRowsMap) {
    const children = childComponents.get(rowId) ?? [];
    actionRow.components = children.map(c => ({
      type: c.type,
      customId: c.customId ?? undefined,
      label: c.label ?? undefined,
      style: c.style ?? undefined,
      url: c.url ?? undefined,
      disabled: c.disabled,
      emoji: c.emoji ?? undefined,
      options: c.options ?? undefined,
      placeholder: c.placeholder ?? undefined,
      minValues: c.minValues ?? undefined,
      maxValues: c.maxValues ?? undefined,
      minLength: c.minLength ?? undefined,
      maxLength: c.maxLength ?? undefined,
      required: c.required ?? undefined,
    }));
  }

  return Array.from(actionRowsMap.values());
}

export async function deleteMessageComponents(messageId: string): Promise<void> {
  await messageComponentRepository.deleteByMessageId(messageId);
}

export async function updateMessageComponents(
  messageId: string,
  components: ComponentData[]
): Promise<void> {
  // Delete existing and recreate
  await deleteMessageComponents(messageId);
  if (components.length > 0) {
    await createMessageComponents(messageId, components);
  }
}
