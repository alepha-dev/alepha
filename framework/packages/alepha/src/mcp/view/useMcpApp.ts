import { AlephaError } from "alepha";
import type { McpToolCallResult } from "alepha/mcp";
import { useSyncExternalStore } from "react";

import type { McpAppBridge, McpAppState } from "./McpAppBridge.ts";
import { McpView } from "./McpView.ts";

/**
 * The MCP Apps call this view shows: the tool's input and result as the host
 * sends them, its theme, and the requests a view may make back.
 *
 * ```tsx
 * const SalesChart = () => {
 *   const app = useMcpApp();
 *   const total = app.result?.structuredContent?.total;
 *   return (
 *     <button onClick={() => app.callTool("refresh_sales")}>
 *       {total ?? "Loading"}
 *     </button>
 *   );
 * };
 * export default SalesChart;
 * ```
 *
 * Only inside a view mounted by `McpView.mount`, which `alepha build` and
 * `alepha dev` do for a `$tool({ ui: { view } })`, or under an explicit
 * `bridge`.
 */
export const useMcpApp = (bridge?: McpAppBridge): UseMcpAppReturn => {
  const active = bridge ?? McpView.bridge;
  if (!active) {
    throw new AlephaError("useMcpApp() is used outside an MCP Apps view");
  }
  const state = useSyncExternalStore(
    (listener) => active.subscribe(listener),
    () => active.getState(),
    () => active.getState(),
  );
  return {
    ...state,
    callTool: (name, args) => active.callTool(name, args),
    openLink: (url) => active.openLink(url),
    sendMessage: (text) => active.sendMessage(text),
  };
};

export interface UseMcpAppReturn extends McpAppState {
  callTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<McpToolCallResult>;
  openLink: (url: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
}
