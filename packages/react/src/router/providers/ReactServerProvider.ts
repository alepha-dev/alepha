import { join } from "node:path";
import { $atom, $env, $hook, $inject, $use, Alepha, AlephaError, type Static, t, } from "alepha";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import { type ServerHandler, ServerRouterProvider, ServerTimingProvider, } from "alepha/server";
import { ServerLinksProvider } from "alepha/server/links";
import { ServerStaticProvider } from "alepha/server/static";
import { renderToReadableStream } from "react-dom/server";
import { ServerHeadProvider } from "@alepha/react/head";
import { Redirection } from "../errors/Redirection.ts";
import { $page, type PagePrimitiveRenderOptions, type PagePrimitiveRenderResult, } from "../primitives/$page.ts";
import { type PageRoute, ReactPageProvider, type ReactRouterState, } from "./ReactPageProvider.ts";
import { ReactServerTemplateProvider } from "./ReactServerTemplateProvider.ts";
import { SSRManifestProvider } from "./SSRManifestProvider.ts";

/**
 * React server provider responsible for SSR and static file serving.
 *
 * Coordinates between:
 * - ReactPageProvider: Page routing and layer resolution
 * - ReactServerTemplateProvider: HTML template parsing and streaming
 * - ServerHeadProvider: Head content management
 * - SSRManifestProvider: Module preload link collection
 *
 * Uses `react-dom/server` under the hood.
 */
export class ReactServerProvider {
  /**
   * SSR response headers - pre-allocated to avoid object creation per request.
   */
  protected readonly SSR_HEADERS = {
    "content-type": "text/html",
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    pragma: "no-cache",
    expires: "0",
  } as const;

  protected readonly fs = $inject(FileSystemProvider);
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly pageApi = $inject(ReactPageProvider);
  protected readonly templateProvider = $inject(ReactServerTemplateProvider);
  protected readonly serverHeadProvider = $inject(ServerHeadProvider);
  protected readonly serverStaticProvider = $inject(ServerStaticProvider);
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly ssrManifestProvider = $inject(SSRManifestProvider);

  /**
   * Cached check for ServerLinksProvider - avoids has() lookup per request.
   */
  protected hasServerLinksProvider = false;

  protected readonly options = $use(reactServerOptions);

  /**
   * Configure the React server provider.
   */
  public readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      const pages = this.alepha.primitives($page);

      const ssrEnabled =
        pages.length > 0 && this.env.REACT_SSR_ENABLED !== false;

      this.alepha.store.set("alepha.react.server.ssr", ssrEnabled);

      // development mode
      if (this.alepha.isViteDev()) {
        await this.configureVite(ssrEnabled);
        return;
      }

      // production mode
      let root = "";

      // non-serverless mode only -> serve static files
      if (!this.alepha.isServerless()) {
        root = await this.getPublicDirectory();
        if (!root) {
          this.log.warn(
            "Missing static files, static file server will be disabled",
          );
        } else {
          this.log.debug(`Using static files from: ${root}`);
          await this.configureStaticServer(root);
        }
      }

      if (ssrEnabled) {
        await this.registerPages(async () => this.template);
        this.log.info("SSR OK");
        return;
      }

      // no SSR enabled, serve index.html for all unmatched routes
      this.log.info("SSR is disabled, use History API fallback");
      this.serverRouterProvider.createRoute({
        path: "*",
        handler: async ({ url, reply }) => {
          if (url.pathname.includes(".")) {
            // If the request is for a file (e.g., /style.css), do not fallback
            reply.headers["content-type"] = "text/plain";
            reply.body = "Not Found";
            reply.status = 404;
            return;
          }

          reply.headers["content-type"] = "text/html";

          // serve index.html for all unmatched routes
          return this.template;
        },
      });
    },
  });

  /**
   * Get the current HTML template.
   */
  public get template() {
    return (
      this.alepha.store.get("alepha.react.server.template") ??
      "<!DOCTYPE html><html lang='en'><head></head><body><div id='root'></div></body></html>"
    );
  }

  /**
   * Register all pages as server routes.
   */
  protected async registerPages(templateLoader: TemplateLoader) {
    // Parse template once at startup
    const template = await templateLoader();
    if (template) {
      this.templateProvider.parseTemplate(template);
    }

    // Set up early head content (entry assets preloads)
    this.setupEarlyHeadContent();

    // Cache ServerLinksProvider check at startup
    this.hasServerLinksProvider = this.alepha.has(ServerLinksProvider);

    for (const page of this.pageApi.getPages()) {
      if (page.component || page.lazy) {
        this.log.debug(`+ ${page.match} -> ${page.name}`);

        this.serverRouterProvider.createRoute({
          ...page,
          schema: undefined, // schema is handled by the page primitive provider
          method: "GET",
          path: page.match,
          handler: this.createHandler(page, templateLoader),
        });
      }
    }
  }

  /**
   * Set up early head content with entry assets.
   *
   * This content is sent immediately when streaming starts, before page loaders run,
   * allowing the browser to start downloading entry.js and CSS files early.
   *
   * Uses <script type="module"> instead of <link rel="modulepreload"> for JS
   * because the script needs to execute anyway - this way the browser starts
   * downloading, parsing, AND will execute as soon as ready.
   *
   * Also strips these assets from the original template head to avoid duplicates.
   */
  protected setupEarlyHeadContent(): void {
    const assets = this.ssrManifestProvider.getEntryAssets();
    if (!assets) {
      return;
    }

    const parts: string[] = [];

    // Add CSS stylesheets (critical for rendering)
    for (const css of assets.css) {
      parts.push(`<link rel="stylesheet" href="${css}" crossorigin="">`);
    }

    // Add entry JS as script module (not just modulepreload)
    // This starts download, parse, AND execution immediately
    if (assets.js) {
      parts.push(
        `<script type="module" crossorigin="" src="${assets.js}"></script>`,
      );
    }

    if (parts.length > 0) {
      // Pass assets so they get stripped from original head content
      this.templateProvider.setEarlyHeadContent(
        parts.join("\n") + "\n",
        assets,
      );
      this.log.debug("Early head content set", {
        css: assets.css.length,
        js: assets.js ? 1 : 0,
      });
    }
  }

  /**
   * Get the public directory path where static files are located.
   */
  protected async getPublicDirectory(): Promise<string> {
    const maybe = [
      join(process.cwd(), `dist/${this.options.publicDir}`),
      join(process.cwd(), this.options.publicDir),
    ];

    for (const it of maybe) {
      if (await this.fs.exists(it)) {
        return it;
      }
    }

    return "";
  }

  /**
   * Configure the static file server to serve files from the given root directory.
   */
  protected async configureStaticServer(root: string) {
    await this.serverStaticProvider.createStaticServer({
      root,
      cacheControl: {
        maxAge: 3600,
        immutable: true,
      },
      ...this.options.staticServer,
    });
  }

  /**
   * Configure Vite for SSR in development mode.
   */
  protected async configureVite(ssrEnabled: boolean) {
    if (!ssrEnabled) {
      // do nothing, vite will handle everything for us
      return;
    }

    const url = `http://localhost:${this.alepha.env.SERVER_PORT ?? "5173"}`;

    this.log.info("SSR (dev) OK", { url });

    await this.registerPages(() =>
      fetch(`${url}/index.html`)
        .then((it) => it.text())
        .catch(() => undefined),
    );
  }

  /**
   * Create the request handler for a page route.
   */
  protected createHandler(
    route: PageRoute,
    templateLoader: TemplateLoader,
  ): ServerHandler {
    return async (serverRequest) => {
      const { url, reply, query, params } = serverRequest;

      // Ensure template is parsed (handles dev mode where template may change)
      if (!this.templateProvider.isReady()) {
        const template = await templateLoader();
        if (!template) {
          throw new AlephaError("Missing template for SSR rendering");
        }
        this.templateProvider.parseTemplate(template);
        this.setupEarlyHeadContent();
      }

      this.log.trace("Rendering page", { name: route.name });

      // Initialize router state
      const state: ReactRouterState = {
        url,
        params,
        query,
        name: route.name,
        onError: () => null,
        layers: [],
        meta: {},
        head: {},
      };

      // Set up API links if available
      if (this.hasServerLinksProvider) {
        this.alepha.store.set(
          "alepha.server.request.apiLinks",
          await this.alepha.inject(ServerLinksProvider).getUserApiLinks({
            user: (serverRequest as any).user, // TODO: fix type
            authorization: serverRequest.headers.authorization,
          }),
        );
      }

      // Check access permissions
      let target: PageRoute | undefined = route;
      while (target) {
        if (route.can && !route.can()) {
          this.log.warn(
            `Access to page '${route.name}' is forbidden by can() check`,
          );
          reply.status = 403;
          reply.headers["content-type"] = "text/plain";
          return "Forbidden";
        }
        target = target.parent;
      }

      await this.alepha.events.emit("react:server:render:begin", {
        request: serverRequest,
        state,
      });

      // Apply SSR headers early
      Object.assign(reply.headers, this.SSR_HEADERS);

      // Resolve global head for early streaming (htmlAttributes only)
      const globalHead = this.serverHeadProvider.resolveGlobalHead();

      // Create optimized HTML stream with early head
      const htmlStream = this.templateProvider.createEarlyHtmlStream(
        globalHead,
        async () => {
          // === ASYNC WORK (runs while early head is being sent) ===
          const result = await this.renderPage(route, state);

          if (result.redirect) {
            // Return redirect URL - template provider will inject meta refresh
            // since HTTP headers have already been sent
            return { redirect: result.redirect };
          }

          return { state, reactStream: result.reactStream! };
        },
        {
          hydration: true,
          onError: (error) => {
            if (error instanceof Redirection) {
              this.log.debug("Streaming resulted in redirection", {
                redirect: error.redirect,
              });
              // Can't do redirect after streaming started - already handled above
            } else {
              this.log.error("HTML stream error", error);
            }
          },
        },
      );

      this.log.trace("Page streaming started (early head optimization)");
      route.onServerResponse?.(serverRequest);
      reply.body = htmlStream;
    };
  }

  // ---------------------------------------------------------------------------
  // Core rendering logic - shared between SSR handler and static prerendering
  // ---------------------------------------------------------------------------

  /**
   * Core page rendering logic shared between SSR handler and static prerendering.
   *
   * Handles:
   * - Layer resolution (loaders)
   * - Redirect detection
   * - Head content filling
   * - Preload link collection
   * - React stream rendering
   *
   * @param route - The page route to render
   * @param state - The router state
   * @returns Render result with redirect or React stream
   */
  protected async renderPage(
    route: PageRoute,
    state: ReactRouterState,
  ): Promise<{ redirect?: string; reactStream?: ReadableStream<Uint8Array> }> {
    // Resolve page layers (loaders)
    const { redirect } = await this.pageApi.createLayers(route, state);
    if (redirect) {
      this.log.debug("Resolver resulted in redirection", { redirect });
      return { redirect };
    }

    // Fill head from route config
    this.serverHeadProvider.fillHead(state);

    // Collect and inject modulepreload links for page-specific chunks
    const preloadLinks = this.ssrManifestProvider.collectPreloadLinks(route);
    if (preloadLinks.length > 0) {
      state.head ??= {};
      state.head.link = [...(state.head.link ?? []), ...preloadLinks];
    }

    // Render React to stream

    const element = this.pageApi.root(state);
    this.alepha.store.set("alepha.react.router.state", state);

    const reactStream = await renderToReadableStream(element, {
      onError: (error: unknown) => {
        if (error instanceof Redirection) {
          this.log.warn("Redirect during streaming ignored", {
            redirect: error.redirect,
          });
        } else {
          this.log.error("Streaming render error", error);
        }
      },
    });

    return { reactStream };
  }

  // ---------------------------------------------------------------------------
  // Testing utilities - kept for backwards compatibility with tests
  // ---------------------------------------------------------------------------

  /**
   * For testing purposes, renders a page to HTML string.
   * Uses the same streaming code path as production, then collects to string.
   *
   * @param name - Page name to render
   * @param options - Render options (params, query, html, hydration)
   */
  public async render(
    name: string,
    options: PagePrimitiveRenderOptions = {},
  ): Promise<PagePrimitiveRenderResult> {
    const page = this.pageApi.page(name);
    const url = new URL(this.pageApi.url(name, options));
    const state: ReactRouterState = {
      url,
      params: options.params ?? {},
      query: options.query ?? {},
      onError: () => null,
      layers: [],
      meta: {},
      head: {},
    };

    this.log.trace("Rendering", { url });

    await this.alepha.events.emit("react:server:render:begin", { state });

    // Ensure template is parsed with early head content (entry.js, CSS)
    if (!this.templateProvider.isReady()) {
      this.templateProvider.parseTemplate(this.template);
      this.setupEarlyHeadContent();
    }

    // Use shared rendering logic
    const result = await this.renderPage(page, state);

    if (result.redirect) {
      return { state, html: "", redirect: result.redirect };
    }

    const reactStream = result.reactStream!;

    // If full HTML page not requested, collect just the React content
    if (!options.html) {
      const html = await this.streamToString(reactStream);
      return { state, html };
    }

    // Create full HTML stream and collect to string
    const htmlStream = this.templateProvider.createHtmlStream(
      reactStream,
      state,
      { hydration: options.hydration ?? true },
    );

    const html = await this.streamToString(htmlStream);

    await this.alepha.events.emit("react:server:render:end", { state, html });

    return { state, html };
  }

  /**
   * Collect a ReadableStream into a string.
   */
  protected async streamToString(
    stream: ReadableStream<Uint8Array>,
  ): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode()); // Flush remaining
    } finally {
      reader.releaseLock();
    }

    return chunks.join("");
  }
}

// ---------------------------------------------------------------------------------------------------------------------

type TemplateLoader = () => Promise<string | undefined>;


// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  REACT_SSR_ENABLED: t.optional(t.boolean()),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
  interface State {
    "alepha.react.server.ssr"?: boolean;
    "alepha.react.server.template"?: string;
  }
}

/**
 * React server provider configuration atom
 */
export const reactServerOptions = $atom({
  name: "alepha.react.server.options",
  schema: t.object({
    publicDir: t.string(),
    staticServer: t.object({
      disabled: t.boolean(),
      path: t.string({
        description: "URL path where static files will be served.",
      }),
    }),
  }),
  default: {
    publicDir: "public",
    staticServer: {
      disabled: false,
      path: "/",
    },
  },
});

export type ReactServerProviderOptions = Static<
  typeof reactServerOptions.schema
>;

declare module "alepha" {
  interface State {
    [reactServerOptions.key]: ReactServerProviderOptions;
  }
}
