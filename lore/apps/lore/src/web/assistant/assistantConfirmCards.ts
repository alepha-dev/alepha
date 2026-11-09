import type { AiChatConfirmCardProps } from "@alepha/ui/ai";
import { type ComponentType, createElement } from "react";

import AssistantWriteCard, {
  type AssistantWriteTool,
} from "./AssistantWriteCard.tsx";

/**
 * The write tools, each with its own card (#Q3210).
 */
const WRITE_TOOLS: AssistantWriteTool[] = [
  "quest_create",
  "quest_comment_add",
  "quest_update",
  "quest_complete",
  "folio_create",
];

/**
 * Lore's confirmation card per write tool, by tool name: `AiChat`'s
 * `confirmCards`. A tool with no card here would get the generic field list.
 */
export const assistantConfirmCards: Record<
  string,
  ComponentType<AiChatConfirmCardProps>
> = Object.fromEntries(
  WRITE_TOOLS.map((tool) => [
    tool,
    (props: AiChatConfirmCardProps) =>
      createElement(AssistantWriteCard, { ...props, tool }),
  ]),
);
