import { $module, type Alepha } from "alepha";

import { LoreAssistantShell } from "./LoreAssistantShell.ts";

/**
 * The assistant's part of the web app (#E120, #E161): the header button that
 * opens the member's own room with Lore, and the tool labels and write cards
 * the chat page draws an agent's answer with. The dock it once held is
 * replaced by that room (#Q3942).
 */
export const LoreAssistantWeb = $module({
  name: "lore.assistant.web",
  register: (alepha: Alepha) => {
    alepha.inject(LoreAssistantShell);
  },
});
