import { $inject, createPrimitive, Primitive } from "alepha";
import { KIND } from "alepha/internal";
import { HeadProvider } from "alepha/react/head";
import { type ServerRequest, ServerRouterProvider } from "alepha/server";

/**
 * Serve a web app manifest generated from code, and link it from every page.
 *
 * Prerendered by default, since nothing in it depends on where the app runs,
 * and answered as `application/manifest+json`.
 *
 * @example
 * ```ts
 * import { $manifest } from "alepha/react/sitemap";
 *
 * class AppRouter {
 *   manifest = $manifest({
 *     name: "My App",
 *     themeColor: "#010409",
 *     icons: [{ src: "/logo-512x512.png", sizes: "512x512", type: "image/png" }],
 *   });
 * }
 * ```
 */
export const $manifest = (
  options: ManifestPrimitiveOptions,
): ManifestPrimitive => {
  return createPrimitive(ManifestPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

export interface ManifestScreenshot {
  src: string;
  sizes?: string;
  type?: string;
  formFactor?: "wide" | "narrow";
  label?: string;
}

export interface ManifestPrimitiveOptions {
  name: string;
  shortName?: string;
  description?: string;

  /**
   * @default "standalone"
   */
  display?: "fullscreen" | "standalone" | "minimal-ui" | "browser";

  /**
   * @default "/"
   */
  startUrl?: string;

  backgroundColor?: string;
  themeColor?: string;
  orientation?: "any" | "portrait" | "landscape";
  icons?: ManifestIcon[];
  screenshots?: ManifestScreenshot[];

  /**
   * Route path the manifest is served at.
   *
   * @default "/manifest.webmanifest"
   */
  path?: string;

  /**
   * Prerender to a static file at build time.
   *
   * @default true
   */
  static?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ManifestPrimitive extends Primitive<ManifestPrimitiveOptions> {
  protected readonly router = $inject(ServerRouterProvider);
  protected readonly head = $inject(HeadProvider);

  protected get path(): string {
    return this.options.path ?? "/manifest.webmanifest";
  }

  protected onInit() {
    this.head.global = [
      ...(this.head.global ?? []),
      { link: [{ rel: "manifest", href: this.path }] },
    ];

    this.router.createRoute({
      method: "GET",
      path: this.path,
      static: this.options.static ?? true,
      silent: true,
      handler: (request: ServerRequest) => {
        request.reply.setHeader("content-type", "application/manifest+json");
        return this.build();
      },
    });
  }

  /**
   * Render the manifest to its path and body. Used by the build to snapshot it
   * to a static file.
   */
  public prerender(): { path: string; body: string } {
    return { path: this.path, body: this.build() };
  }

  /**
   * The manifest's own spelling is snake case, and JSON drops what is unset.
   */
  protected build(): string {
    const { options } = this;
    return JSON.stringify({
      name: options.name,
      short_name: options.shortName,
      description: options.description,
      display: options.display ?? "standalone",
      start_url: options.startUrl ?? "/",
      background_color: options.backgroundColor,
      theme_color: options.themeColor,
      orientation: options.orientation,
      icons: options.icons,
      screenshots: options.screenshots?.map(({ formFactor, ...rest }) => ({
        ...rest,
        form_factor: formFactor,
      })),
    });
  }
}

$manifest[KIND] = ManifestPrimitive;
