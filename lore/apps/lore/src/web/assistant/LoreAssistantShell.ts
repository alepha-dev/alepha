import { ShellExtensionRegistry } from "@lore/core/web";
import { $inject } from "alepha";

import AssistantHeaderButton from "./AssistantHeaderButton.tsx";
import AssistantPanel from "./AssistantPanel.tsx";

/**
 * Puts the assistant in Lore's chrome (#Q3211): its toggle in the header
 * cluster, its panel at the layout's root. Core renders both through
 * `ShellExtensionRegistry` and names neither.
 */
export class LoreAssistantShell {
  protected readonly shell = $inject(ShellExtensionRegistry);

  constructor() {
    this.shell.registerHeaderAction({
      key: "assistant",
      component: AssistantHeaderButton,
    });
    this.shell.registerOverlay({ key: "assistant", component: AssistantPanel });
  }
}
