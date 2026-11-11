import type { PrimitiveSide } from "alepha";
import { $inject, createPrimitive, Primitive } from "alepha";
import { KIND } from "alepha/internal";
import { type ServerRequest, ServerRouterProvider } from "alepha/server";

/**
 * Serve a `robots.txt` generated from code.
 *
 * Any host other than the canonical one answers `Disallow: /`, so a staging
 * deploy or a `workers.dev` preview keeps itself out of search engines without
 * anyone remembering to. Canonical is `options.host`, else `PUBLIC_URL`; with
 * neither set there is no host to compare, and `isProduction()` decides.
 *
 * Runtime by default, unlike `$sitemap`: the answer depends on where the app
 * runs, and a prerendered file would be the build's on every host, since one
 * artifact deploys everywhere and static files mount over the route.
 *
 * @example
 * ```ts
 * import { $robots } from "alepha/react/sitemap";
 *
 * class AppRouter {
 *   robots = $robots({ disallow: ["/admin"] });
 * }
 * ```
 */
export const $robots = (
  options: RobotsPrimitiveOptions = {},
): RobotsPrimitive => {
  return createPrimitive(RobotsPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RobotsPrimitiveOptions {
  /**
   * Paths crawlers are asked to stay out of, on the canonical host.
   *
   * @example ["/admin", "/account"]
   */
  disallow?: string[];

  /**
   * The canonical host, or a URL holding it.
   *
   * @default `PUBLIC_URL`
   */
  host?: string;

  /**
   * Route path the file is served at.
   *
   * @default "/robots.txt"
   */
  path?: string;

  /**
   * Prerender to a static file at build time. The file then answers on every
   * host, canonical or not, so it only suits an app with one.
   *
   * @default false
   */
  static?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class RobotsPrimitive extends Primitive<RobotsPrimitiveOptions> {
  /**
   * `boot` for the pure controller rule: read by the prerender at boot.
   */
  public static override readonly side: PrimitiveSide = "boot";

  protected readonly router = $inject(ServerRouterProvider);

  protected get path(): string {
    return this.options.path ?? "/robots.txt";
  }

  protected onInit() {
    this.router.createRoute({
      method: "GET",
      path: this.path,
      silent: true,
      handler: (request: ServerRequest) => {
        request.reply.setHeader("content-type", "text/plain; charset=utf-8");
        return this.isCanonical(request)
          ? this.build()
          : "User-agent: *\nDisallow: /\n";
      },
    });
  }

  /**
   * Render the canonical file to its path and body. Used by the build when
   * `static` is set.
   */
  public prerender(): { path: string; body: string } {
    return { path: this.path, body: this.build() };
  }

  protected isCanonical(request: ServerRequest): boolean {
    const canonical = this.options.host ?? this.alepha.env.PUBLIC_URL;
    if (!canonical) {
      return this.alepha.isProduction();
    }

    // What the client asked for: behind a proxy, `host` is the upstream.
    const forwarded = request.headers["x-forwarded-host"];
    const host =
      (typeof forwarded === "string" ? forwarded : undefined) ??
      request.headers.host ??
      request.url.host;

    return this.hostOf(host) === this.hostOf(String(canonical));
  }

  protected hostOf(value: string): string {
    const first = value.split(",")[0].trim().toLowerCase();
    return /^https?:\/\//.test(first) ? new URL(first).host : first;
  }

  protected build(): string {
    const lines = ["User-agent: *"];
    const disallow = this.options.disallow ?? [];

    if (disallow.length === 0) {
      lines.push("Allow: /");
    }
    for (const path of disallow) {
      lines.push(`Disallow: ${path}`);
    }

    const sitemaps = this.sitemaps();
    if (sitemaps.length > 0) {
      lines.push("", ...sitemaps.map((url) => `Sitemap: ${url}`));
    }

    return `${lines.join("\n")}\n`;
  }

  /**
   * The absolute URL of each `$sitemap`. The `Sitemap:` directive refuses a
   * relative one, so a sitemap with no hostname is left out.
   */
  protected sitemaps(): string[] {
    return (this.alepha.primitives("sitemap") as Array<Primitive<any>>)
      .map((sitemap) => {
        const { hostname, path } = sitemap.options as {
          hostname?: string;
          path?: string;
        };
        const base = hostname ?? String(this.alepha.env.PUBLIC_URL ?? "");
        return `${base.replace(/\/$/, "")}${path ?? "/sitemap.xml"}`;
      })
      .filter((url) => /^https?:\/\//.test(url));
  }
}

$robots[KIND] = RobotsPrimitive;
