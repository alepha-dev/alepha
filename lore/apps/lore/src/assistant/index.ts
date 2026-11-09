import { $module, type Alepha } from "alepha";
import { AlephaAiCloudflare } from "alepha/ai/cloudflare";
import { AiController, AiSettings, AlephaApiAi } from "alepha/api/ai";

import { LoreAiAssistant } from "./LoreAiAssistant.ts";
import { LoreAiAudits } from "./LoreAiAudits.ts";
import { LoreAiContext } from "./LoreAiContext.ts";
import { LoreAiController } from "./LoreAiController.ts";
import { LoreAiPrompt } from "./LoreAiPrompt.ts";
import { LoreAiSettings } from "./LoreAiSettings.ts";
import { LoreAiStatusController } from "./LoreAiStatusController.ts";
import { LoreAiSwitch } from "./LoreAiSwitch.ts";
import { LoreAiToolAccess } from "./LoreAiToolAccess.ts";
import { LoreAiToolset } from "./LoreAiToolset.ts";

export { LoreAiAssistant } from "./LoreAiAssistant.ts";
export { LoreAiAudits } from "./LoreAiAudits.ts";
export { LoreAiContext } from "./LoreAiContext.ts";
export { LoreAiController } from "./LoreAiController.ts";
export { LoreAiPrompt } from "./LoreAiPrompt.ts";
export { LoreAiSettings } from "./LoreAiSettings.ts";
export { LoreAiStatusController } from "./LoreAiStatusController.ts";
export { LoreAiSwitch } from "./LoreAiSwitch.ts";
export { LoreAiToolAccess } from "./LoreAiToolAccess.ts";
export { type LoreAiTool, LoreAiToolset } from "./LoreAiToolset.ts";

/**
 * Lore's in-app assistant, the server half (#E120): `alepha/api/ai` on
 * Workers AI, behind the `AI_ASSISTANT_ENABLED` switch and a sign-in gate.
 *
 * Registered by `main.server.ts` after every `@lore/*` module, since the
 * assistant's tools are theirs. Always registered, switch or not, so the
 * `ai_conversations` and `ai_messages` tables are part of every schema.
 *
 * ⚠️ The order inside is load-bearing, because the first substitution wins:
 * the vendor module, then the controller and settings substitutions, then
 * `AlephaApiAi` (an import, wired after `register`), which registers what
 * they replace.
 *
 * @module
 */
export const LoreAssistant = $module({
  name: "lore.assistant",
  register: (alepha: Alepha) => {
    alepha.with(AlephaAiCloudflare);
    alepha.with({ provide: AiController, use: LoreAiController });
    alepha.with({ provide: AiSettings, use: LoreAiSettings });
  },
  imports: [AlephaApiAi],
  services: [
    LoreAiSwitch,
    LoreAiContext,
    LoreAiPrompt,
    LoreAiToolset,
    LoreAiToolAccess,
    LoreAiAssistant,
    LoreAiAudits,
    LoreAiStatusController,
  ],
});
