import type { AiChatConfirmCardProps } from "@alepha/ui/ai";
import type { ComponentType } from "react";

/**
 * Lore's confirmation card per write tool, by tool name (#Q3210). Empty
 * until the write tools land: a tool with no card here gets `AiChat`'s
 * generic field list.
 */
export const assistantConfirmCards: Record<
  string,
  ComponentType<AiChatConfirmCardProps>
> = {};
