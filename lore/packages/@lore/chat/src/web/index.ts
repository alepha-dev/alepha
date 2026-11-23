import { LoreCoreWeb } from "@lore/core/web";
import { $module } from "alepha";
import { AlephaWebSocket } from "alepha/websocket";

import { ChatChannels } from "../schemas/ChatChannels.ts";
import { ChatRouter } from "./app/ChatRouter.ts";
import { ChatProjectLoader } from "./app/loaders/ChatProjectLoader.ts";
import { ChatAgentUiRegistry } from "./app/services/ChatAgentUiRegistry.ts";
import { ChatFeedHub } from "./app/services/ChatFeedHub.ts";
import { ChatUnread } from "./app/services/ChatUnread.ts";
import { ToolTrace } from "./app/services/toolTrace.ts";
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
  // The socket client too: the Chat page holds the member's live feed.
  imports: [LoreCoreWeb, AlephaWebSocket],
  register(alepha) {
    // Injected rather than listed in `services`, as every package does: a
    // listed service is tagged with this module.
    alepha.with(ChatRouter);
    // At boot, as every service a page injects: the container is locked
    // once the app has started.
    alepha.with(ChatChannels);
    alepha.with(ChatFeedHub);
    alepha.with(ChatUnread);
    alepha.with(ChatAgentUiRegistry);
    alepha.with(ToolTrace);
    alepha.inject(ChatProjectLoader);
    alepha.inject(ChatShell);
  },
});

export { ChatRouter } from "./app/ChatRouter.ts";
export { useChatToolSummary } from "./app/hooks/useChatToolSummary.ts";
export { ChatAgentUiRegistry } from "./app/services/ChatAgentUiRegistry.ts";
export { ChatShell } from "./app/shell/ChatShell.ts";

/**
 * Chat's router in the app's router registry (#Q3187).
 */
declare module "alepha/react/router" {
  interface Routers {
    loreChat: ChatRouter;
  }
}
