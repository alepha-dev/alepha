import { LoreCoreWeb } from "@lore/core/web";
import { $module } from "alepha";

import { ChatRouter } from "./app/ChatRouter.ts";
import { ChatShell } from "./app/shell/ChatShell.ts";

/**
 * The browser-safe half of `@lore/chat` (#E161): its pages and its part of
 * the project shell.
 *
 * Registered by BOTH entries, `main.server.ts` and `main.browser.ts`: the
 * server renders and the browser hydrates from the same page registry.
 *
 * It imports another package's `./api` or `./mcp` as `import type` only.
 *
 * @module
 */
export const LoreChatWeb = $module({
  name: "lore.chat.web",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreWeb],
  register(alepha) {
    // Injected rather than listed in `services`, as every package does: a
    // listed service is tagged with this module.
    alepha.with(ChatRouter);
    alepha.inject(ChatShell);
  },
});

export { ChatRouter } from "./app/ChatRouter.ts";
export { ChatShell } from "./app/shell/ChatShell.ts";

/**
 * Chat's router in the app's router registry (#Q3187).
 */
declare module "alepha/react/router" {
  interface Routers {
    loreChat: ChatRouter;
  }
}
