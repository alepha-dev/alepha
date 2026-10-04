import { $hook, $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { ReactBrowserProvider } from "alepha/react/router";

import type { DeepLink } from "../interfaces/DeepLink.ts";
import { CapacitorConfigProvider } from "./CapacitorConfigProvider.ts";

/**
 * Custom-scheme deep links: `<scheme>://app/<path>?query#hash` opens that
 * path of the app.
 *
 * - **Cold:** the link that launched the app is staged as the router's first
 *   URL (`ReactBrowserProvider.initialUrlResolver`), before the first
 *   transition: the WebView itself always loads `index.html`.
 * - **Warm:** a link opened while the app runs is pushed onto the router.
 * - Only the shell's own scheme (from its public config, so a variant only
 *   ever answers its own) and the host `app` are routes. Anything else is
 *   ignored: another scheme or host, user info, a malformed encoding, a `..`
 *   segment. Nothing about a refused link is logged beyond its scheme.
 * - `<scheme>://auth/callback` is reserved for a sign-in finished in the
 *   system browser. It goes to {@link authCallback} when one is installed and
 *   is refused by name otherwise, never routed.
 *
 * The same link reported twice (as the launch URL and as an `appUrlOpen`
 * event, which iOS does on a cold start) is handled once.
 *
 * The web implementation (this class) listens to nothing: a website has its
 * URL bar. The native one reads `@capacitor/app`.
 */
export class DeepLinkProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly config = $inject(CapacitorConfigProvider);

  /**
   * Completes a sign-in that returned on `<scheme>://auth/callback`. None in
   * v1: password sign-in happens inside the app.
   */
  public authCallback?: (url: URL) => Promise<void>;

  /**
   * How long the same link counts as already handled.
   */
  public duplicateWindow = 2000;

  protected last?: { url: string; at: number };

  /**
   * Whether the first screen is up, so a link can be pushed.
   */
  protected routed = false;

  /**
   * A link that arrived before the first screen: Capacitor also reports the
   * launch link as `appUrlOpen`, and it can come before the router has a
   * state to push onto.
   */
  protected early?: string;

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      if (!this.config.isShell() || !this.alepha.isBrowser()) {
        return;
      }
      this.alepha.inject(ReactBrowserProvider).initialUrlResolver = () =>
        this.resolveLaunch();
    },
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      await this.listen();
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      this.routed = false;
      await this.unlisten();
    },
  });

  /**
   * After the router's own `ready` (the first transition), open the link
   * that came too early, unless the launch resolver already opened it. That
   * is the cold link of a hydrated page, which has no resolver: the server
   * rendered its own URL first.
   */
  protected readonly onReady = $hook({
    on: "ready",
    priority: "last",
    handler: async () => {
      this.routed = true;
      const early = this.early;
      this.early = undefined;
      if (early && early !== this.last?.url) {
        await this.receive(early).catch((error) => {
          this.log.error("Could not open the link", error);
        });
      }
    },
  });

  /**
   * Read a link. `undefined` for anything that is not this app's.
   */
  public parse(raw: string): DeepLink | undefined {
    const scheme = this.config.get()?.scheme;
    if (!scheme) {
      return undefined;
    }

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return undefined;
    }

    if (url.protocol !== `${scheme}:` || url.username || url.password) {
      return undefined;
    }

    if (url.host === "auth" && url.pathname === "/callback") {
      return { kind: "auth", url };
    }
    if (url.host !== "app") {
      return undefined;
    }

    // The raw path, before URL normalised `..` away: a link carrying one is
    // refused rather than quietly resolved somewhere else.
    const rawPath = raw.slice(raw.indexOf("://app") + "://app".length);
    try {
      const decoded = decodeURIComponent(rawPath.split(/[?#]/)[0]);
      if (decoded.split("/").includes("..") || decoded.includes("\\")) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    const path = url.pathname === "" ? "/" : url.pathname;
    return { kind: "route", path: `${path}${url.search}${url.hash}` };
  }

  /**
   * The launch link, as the path the first screen should show.
   */
  public async resolveLaunch(): Promise<string | undefined> {
    const url = await this.launchUrl();
    if (!url) {
      return undefined;
    }
    this.remember(url);
    try {
      return await this.toPath(url);
    } catch (error) {
      // A refused sign-in callback must not fail the boot: the app opens
      // where it would have without the link.
      this.log.error("Could not open the launch link", error);
      return undefined;
    }
  }

  /**
   * A link opened while the app runs.
   */
  public async receive(url: string): Promise<void> {
    if (this.isDuplicate(url)) {
      return;
    }
    // Only a route needs the router; a sign-in callback does not wait.
    if (!this.routed && this.parse(url)?.kind === "route") {
      this.early = url;
      return;
    }
    this.remember(url);
    const path = await this.toPath(url);
    if (path) {
      await this.alepha.inject(ReactBrowserProvider).push(path);
    }
  }

  protected async toPath(raw: string): Promise<string | undefined> {
    const link = this.parse(raw);
    if (!link) {
      this.log.debug("Ignoring a link that is not this app's", {
        scheme: raw.split(":")[0],
      });
      return undefined;
    }
    if (link.kind === "auth") {
      if (!this.authCallback) {
        throw new AlephaError(
          "A sign-in returned to this app, which has no browser sign-in installed. Sign in with a password.",
        );
      }
      await this.authCallback(link.url);
      return undefined;
    }
    return link.path;
  }

  protected isDuplicate(url: string): boolean {
    return (
      this.last?.url === url &&
      this.dateTime.nowMillis() - this.last.at < this.duplicateWindow
    );
  }

  protected remember(url: string): void {
    this.last = { url, at: this.dateTime.nowMillis() };
  }

  /**
   * The link the app was launched with, if any.
   */
  protected async launchUrl(): Promise<string | undefined> {
    return undefined;
  }

  protected async listen(): Promise<void> {}

  protected async unlisten(): Promise<void> {}
}
