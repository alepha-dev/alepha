import { ChatAgentUiRegistry } from "@lore/chat/web";
import { ShellExtensionRegistry } from "@lore/core/web";
import { $inject } from "alepha";

import { assistantConfirmCards } from "./assistantConfirmCards.ts";
import AssistantHeaderButton from "./AssistantHeaderButton.tsx";
import { useAssistantToolLabel } from "./useAssistantToolLabel.ts";

/**
 * Puts the assistant in Lore's chrome (#Q3211): its toggle in the header
 * cluster, its panel at the layout's root. Core renders both through
 * `ShellExtensionRegistry` and names neither.
 */
export class LoreAssistantShell {
  protected readonly shell = $inject(ShellExtensionRegistry);
  protected readonly chatAgents = $inject(ChatAgentUiRegistry);

  constructor() {
    this.shell.registerHeaderAction({
      key: "assistant",
      component: AssistantHeaderButton,
    });
    // `@lore` in a chat room shows the dock's own tool labels and write
    // cards (#Q3956): drawn once, in the app, and lent to chat.
    this.chatAgents.register({
      cards: assistantConfirmCards,
      useToolLabel: useAssistantToolLabel,
    });
  }
}
