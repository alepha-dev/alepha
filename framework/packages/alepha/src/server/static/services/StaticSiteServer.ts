import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { $env, $hook, $inject, Alepha, z } from "alepha";
import { $logger } from "alepha/logger";
import { ServerRouterProvider } from "alepha/server";

import type { StaticFileSource } from "../interfaces/StaticFileSource.ts";
import { ServerStaticProvider } from "../providers/ServerStaticProvider.ts";
import { DiskStaticFileSource } from "./DiskStaticFileSource.ts";

/**
 * A server for a static build, and nothing of the app: what `alepha image`
 * runs for a `runtime: ["static"]` artifact, bundled on its own.
 *
 * It serves `STATIC_ROOT` (`./public`) the way Cloudflare and Bay serve a
 * static site (`$serve({ site: true, headersFile: true })`), with the
 * precompressed siblings, the `_headers` rules and both fallbacks.
 *
 * When the build's `manifest.json` lists `browser` keys, `/config.js` is
 * answered from this process's environment, for those keys only: one image,
 * many environments, with no shell entrypoint rewriting a file. The
 * `config.js` the build wrote, with the build machine's values, is never
 * served.
 *
 * ```ts
 * import { Alepha, run } from "alepha";
 * import { StaticSiteServer } from "alepha/server/static";
 *
 * run(Alepha.create().with(StaticSiteServer));
 * ```
 */
export class StaticSiteServer {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly staticProvider = $inject(ServerStaticProvider);
  protected readonly router = $inject(ServerRouterProvider);

  protected readonly env = $env(
    z.object({
      STATIC_ROOT: z.text({
        secret: false,
        default: "./public",
        description: "The directory of the static build to serve.",
      }),
      STATIC_MANIFEST: z.text({
        secret: false,
        default: "./manifest.json",
        description:
          "The build's manifest, whose `browser` list names the keys /config.js answers.",
      }),
    }),
  );

  protected readonly configure = $hook({
    on: "configure",
    handler: async () => {
      const keys = await this.browserKeys();
      const disk = new DiskStaticFileSource(this.resolve(this.env.STATIC_ROOT));
      const source = keys.length > 0 ? this.withoutConfig(disk) : disk;

      if (keys.length > 0) {
        this.router.createRoute({
          method: "GET",
          path: "/config.js",
          handler: (request) => {
            request.reply.headers["content-type"] =
              "text/javascript; charset=utf-8";
            request.reply.headers["cache-control"] =
              "public, max-age=0, must-revalidate";
            return this.configScript(keys);
          },
        });
      }

      await this.staticProvider.createStaticServer(
        { path: "/", site: true, headersFile: true },
        source,
      );
      this.log.info("Serving a static site", {
        root: this.env.STATIC_ROOT,
        browserKeys: keys,
      });
    },
  });

  /**
   * The `browser` keys the manifest lists, or none without one.
   */
  protected async browserKeys(): Promise<string[]> {
    try {
      const manifest = JSON.parse(
        await readFile(this.resolve(this.env.STATIC_MANIFEST), "utf8"),
      ) as { browser?: unknown };
      return Array.isArray(manifest.browser)
        ? manifest.browser.filter((it): it is string => typeof it === "string")
        : [];
    } catch {
      return [];
    }
  }

  /**
   * `config.js` for `keys`, from this process's environment: a key the
   * manifest does not list is never in it, whatever the environment holds.
   */
  public configScript(keys: string[]): string {
    const values: Record<string, string> = {};
    for (const key of keys) {
      const value = this.alepha.env[key];
      if (value !== undefined && value !== null) {
        values[key] = String(value as string | number | boolean);
      }
    }
    return `globalThis.${Alepha.BROWSER_ENV_GLOBAL} = ${JSON.stringify(values).replace(/</g, "\\u003c")};\n`;
  }

  /**
   * `source` without the build's own `config.js` and its siblings, which
   * the route above replaces.
   */
  protected withoutConfig(source: StaticFileSource): StaticFileSource {
    const hidden = (path: string) =>
      path === "/config.js" || path.startsWith("/config.js.");
    return {
      list: async () => (await source.list()).filter((it) => !hidden(it)),
      stat: (path) => source.stat(path),
      has: async (path) => !hidden(path) && (await source.has(path)),
      open: async (path) => (hidden(path) ? undefined : source.open(path)),
    };
  }

  protected resolve(path: string): string {
    return isAbsolute(path) ? path : join(process.cwd(), path);
  }
}
