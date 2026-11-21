import { $module, type Alepha } from "alepha";

import { assistantOpenAtom } from "./assistantOpenAtom.ts";
import { LoreAssistantShell } from "./LoreAssistantShell.ts";

/**
 * Lore's in-app assistant, the browser half (#E120): the header toggle and
 * the dock. Registered by BOTH entries, after `LoreCoreWeb`, since SSR and
 * hydration read the same shell registry.
 *
 * @module
 */
export const LoreAssistantWeb = $module({
  name: "lore.assistant.web",
  atoms: [assistantOpenAtom],
  register: (alepha: Alepha) => {
    alepha.inject(LoreAssistantShell);
  },
});
