import { LoreCoreWeb } from "@lore/core/web";
import { $module } from "alepha";

import { PromptsRouter } from "./PromptsRouter.ts";

/**
 * The browser-safe half of `@lore/prompts` (#E175): its pages and what it
 * puts in core's web slots.
 *
 * Registered by BOTH entries, `main.server.ts` and `main.browser.ts`: the
 * server renders and the browser hydrates from the same page registry.
 *
 * It imports another package's `./api` or `./mcp` as `import type` only.
 *
 * @module
 */
export const LorePromptsWeb = $module({
  name: "lore.prompts.web",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreWeb],
  register(alepha) {
    // Injected rather than listed in `services`, as every package does: a
    // listed service is tagged with this module.
    alepha.with(PromptsRouter);
  },
});

export { PromptsRouter } from "./PromptsRouter.ts";

/**
 * Prompts' router in the app's router registry (#Q3187).
 */
declare module "alepha/react/router" {
  interface Routers {
    lorePrompts: PromptsRouter;
  }
}
