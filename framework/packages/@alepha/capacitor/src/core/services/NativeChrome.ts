import { Capacitor } from "@capacitor/core";
import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

import { SplashScreenProvider } from "../providers/SplashScreenProvider.ts";
import { StatusBarProvider } from "../providers/StatusBarProvider.ts";

/**
 * What makes a WebView feel like the platform's, inside the native shell only.
 *
 * - `<html data-native="ios|android">`, the hook for native-only CSS (the
 *   `@alepha/ui` stylesheet scopes its tap, callout and overscroll policy to
 *   it), so the same app served as a website keeps the browser's behavior;
 * - `viewport-fit=cover` on the viewport: the bundled shell declares it in its
 *   document already, a page served by `alepha capacitor dev` gets it here;
 * - the splash hides when the first screen settles (`react:boot:settled`),
 *   healthy or failed, never on a timer and never on bare `ready`, so a
 *   failure is on the screen rather than masked behind the splash;
 * - the status bar follows the theme: `class="dark"` on `<html>` (what
 *   `alepha/react/ui`'s `ColorScheme` toggles) asks for light content.
 *
 * Registered by `AlephaCapacitor` inside the native shell only.
 */
export class NativeChrome {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly splash = $inject(SplashScreenProvider);
  protected readonly statusBar = $inject(StatusBarProvider);
  protected observer?: MutationObserver;

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      if (typeof document === "undefined") {
        return;
      }
      document.documentElement.dataset.native = this.platform();
      this.coverViewport();
    },
  });

  protected readonly onSettled = $hook({
    on: "react:boot:settled",
    handler: () => {
      this.splash
        .hide()
        .catch((error) => this.log.warn("Could not hide the splash", error));
    },
  });

  protected readonly onReady = $hook({
    on: "ready",
    handler: () => {
      this.followTheme();
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => {
      this.observer?.disconnect();
      this.observer = undefined;
    },
  });

  /**
   * The platform the shell runs on. A method so a spec can name one.
   */
  protected platform(): string {
    return Capacitor.getPlatform();
  }

  protected coverViewport(): void {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="viewport"]',
    );
    if (!meta) {
      return;
    }
    const content = meta.getAttribute("content") ?? "";
    if (!/viewport-fit\s*=/.test(content)) {
      meta.setAttribute(
        "content",
        content ? `${content}, viewport-fit=cover` : "viewport-fit=cover",
      );
    }
  }

  protected followTheme(): void {
    if (typeof document === "undefined" || this.observer) {
      return;
    }
    const root = document.documentElement;
    let current: "light" | "dark" | undefined;
    const apply = () => {
      const style = root.classList.contains("dark") ? "dark" : "light";
      if (style === current) {
        return;
      }
      current = style;
      this.statusBar
        .setStyle(style)
        .catch((error) =>
          this.log.warn("Could not set the status bar style", error),
        );
    };
    apply();
    this.observer = new MutationObserver(apply);
    this.observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}
