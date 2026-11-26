import { type ComponentType, createElement } from "react";
import { createRoot } from "react-dom/client";

import { McpAppBridge } from "./McpAppBridge.ts";

/**
 * Mounts an MCP Apps view: the entry `alepha build` and `alepha dev`
 * generate for a `$tool({ ui: { view } })` calls {@link mount} with the
 * component the view module exports by default.
 */
export class McpView {
  /**
   * The bridge of the view running in this document, once mounted.
   */
  public static bridge?: McpAppBridge;

  /**
   * Render `component` into `#root`, open the bridge with the host, follow
   * the host's theme on `<html>` (`class="dark"`, `color-scheme`, the
   * host's CSS variables), and report the view's size as it changes.
   */
  public static mount(
    component: ComponentType | { default: ComponentType },
  ): McpAppBridge {
    const View =
      typeof component === "function"
        ? component
        : (component as { default: ComponentType }).default;
    const bridge = new McpAppBridge(window.parent, window);
    McpView.bridge = bridge;

    bridge.subscribe(() => McpView.applyTheme(bridge));
    void bridge.connect();

    const root = document.getElementById("root") ?? document.body;
    createRoot(root).render(createElement(View));

    new ResizeObserver(() => {
      const box = document.documentElement.getBoundingClientRect();
      bridge.notifySize(Math.ceil(box.width), Math.ceil(box.height));
    }).observe(document.documentElement);

    return bridge;
  }

  protected static applyTheme(bridge: McpAppBridge): void {
    const html = document.documentElement;
    const { theme, hostContext } = bridge.state;
    html.classList.toggle("dark", theme === "dark");
    html.style.colorScheme = theme;
    const variables = hostContext.styles?.variables;
    if (variables && typeof variables === "object") {
      for (const [name, value] of Object.entries(variables)) {
        if (name.startsWith("--") && typeof value === "string") {
          html.style.setProperty(name, value);
        }
      }
    }
  }
}
