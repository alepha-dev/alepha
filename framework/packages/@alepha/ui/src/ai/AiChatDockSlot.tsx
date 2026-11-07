import { cn } from "../core/utils.ts";

/**
 * The `data-slot` that marks the column an `AiChatDock` renders into.
 */
export const AI_CHAT_DOCK_SLOT = "ai-chat-dock";

export interface AiChatDockSlotProps {
  className?: string;
}

/**
 * Where a layout makes room for the assistant's dock: a column beside the
 * page, empty and zero-wide until the dock opens. Pass it to `AppShell` as
 * `aside`; any other layout puts it as a flex sibling of its content. Without one, the dock floats over the page's right edge
 * instead, still without a backdrop.
 */
export const AiChatDockSlot = (props: AiChatDockSlotProps) => (
  <div
    data-slot={AI_CHAT_DOCK_SLOT}
    className={cn("flex min-h-0 shrink-0", props.className)}
  />
);
