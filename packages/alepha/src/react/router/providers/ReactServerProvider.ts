import { join } from "node:path";
import {
  $atom,
  $env,
  $hook,
  $inject,
  $store,
  Alepha,
  type Infer,
  type Middleware,
  OPTIONS,
  PipelineHandler,
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import { ServerHeadProvider } from "alepha/react/head";
import { type ServerHandler, ServerRouterProvider } from "alepha/server";
import { ServerLinksProvider } from "alepha/server/links";
import { ServerStaticProvider } from "alepha/server/static";
import { FileSystemProvider } from "alepha/system";
import { renderToReadableStream } from "react-dom/server";
import { Redirection } from "../errors/Redirection.ts";
import {
  $page,
  type PagePrimitiveRenderOptions,
  type PagePrimitiveRenderResult,
} from "../primitives/$page.ts";
import {
  type PageRoute,
  ReactPageProvider,
  type ReactRouterState,
  reactPageOptions,
} from "./ReactPageProvider.ts";
import { ReactServerTemplateProvider } from "./ReactServerTemplateProvider.ts";
import { RouterLocaleProvider } from "./RouterLocaleProvider.ts";
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
  protected readonly localeProvider = $inject(RouterLocaleProvider);

  /**
   * Cached check for ServerLinksProvider - avoids has() lookup per request.
   */
  protected hasServerLinksProvider = false;

  protected readonly options = $store(reactServerOptions);
  protected readonly pageOptions = $store(reactPageOptions);

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

      // production mode
      let root = "";

      // non-serverless mode only -> serve static files
      if (!this.alepha.isServerless() && !this.alepha.isViteDev()) {
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
        this.registerPages();
        this.log.info("SSR OK");
        return;
      }

      // no SSR enabled, serve a minimal fallback
      this.log.info("SSR is disabled");
    },
  });

  /**
   * Register all pages as server routes.
   */
  protected registerPages(): void {
    // Set up early head content (entry assets)
    this.setupEarlyHeadContent();

    // Cache ServerLinksProvider check at startup
    this.hasServerLinksProvider = this.alepha.has(ServerLinksProvider);

    for (const page of this.pageApi.getPages()) {
      if (page.component || page.lazy || page.redirect) {
        this.log.debug(`+ ${page.match} -> ${page.name}`);

        // Collect middleware from the entire parent chain + own page.
        // Parent middleware runs first (outermost → innermost).
        const allMiddleware = this.collectMiddleware(page);

        // Separate $cache from server-level middleware.
        // $cache is applied inside createHandler around the render function,
        // not around the entire server handler (which works via side effects).
        const cacheMiddleware = allMiddleware.filter(
          (m) => m[OPTIONS]?.name === "$cache",
        );
        const serverMiddleware = allMiddleware.filter(
          (m) => m[OPTIONS]?.name !== "$cache",
        );

        const rawHandler = this.createHandler(page, cacheMiddleware);
        const handler = serverMiddleware.length
          ? new PipelineHandler(rawHandler, serverMiddleware)
          : rawHandler;

        // Canonical (default-locale) route, served unprefixed.
        this.serverRouterProvider.createRoute({
          ...page,
          schema: undefined, // schema is handled by the page primitive provider
          // A page's `static` is page-shaped (`{ entries }`) and handled by the
          // page prerender pass — it must not leak into the route's boolean
          // `static` snapshot flag.
          static: undefined,
          method: "GET",
          path: page.match,
          handler,
        });

        // Locale-prefixed variants (`/fr/about`, …) point at the SAME handler.
        // The handler reads the active locale back out of the request URL, so
        // no extra route param is needed and matching stays native.
        if (this.localeProvider.enabled) {
          for (const locale of this.localeProvider.prefixedLocales) {
            const prefixedPath = this.localeProvider.withPrefix(
              page.match,
              locale,
            );
            this.log.debug(`+ ${prefixedPath} -> ${page.name} (${locale})`);
            this.serverRouterProvider.createRoute({
              ...page,
              schema: undefined,
              static: undefined,
              method: "GET",
              path: prefixedPath,
              handler,
            });
          }
        }
      }
    }
  }

  /**
   * Set up early head content with entry assets.
   *
   * This content is sent immediately when streaming starts, before page loaders run,
   * allowing the browser to start downloading entry.js and CSS files early.
   */
  protected setupEarlyHeadContent(): void {
    const globalHead = this.serverHeadProvider.resolveGlobalHead();
    const manifest = this.ssrManifestProvider.getManifest();
    const faviconTag = this.buildFaviconTag(manifest.favicon);

    // Dev mode: use pre-transformed head content from Vite
    if (manifest.devHead) {
      const devContent = faviconTag
        ? `${faviconTag}\n${manifest.devHead}\n`
        : `${manifest.devHead}\n`;
      this.templateProvider.setEarlyHeadContent(devContent, globalHead);
      this.log.debug("Early head content set (dev mode)");
      return;
    }

    // Production: build from SSR manifest entry assets
    const parts: string[] = [];
    if (faviconTag) {
      parts.push(faviconTag);
    }
    const assets = this.ssrManifestProvider.getEntryAssets();
    if (assets) {
      for (const css of assets.css) {
        parts.push(`<link rel="stylesheet" href="${css}">`);
      }
      if (assets.js) {
        parts.push(
          `<script type="module" crossorigin="" src="${assets.js}"></script>`,
        );
      }
    }

    this.templateProvider.setEarlyHeadContent(
      parts.length > 0 ? `${parts.join("\n")}\n` : "",
      globalHead,
    );

    this.log.debug("Early head content set", {
      parts: parts.length,
    });
  }

  /**
   * Build a favicon link tag from the manifest favicon value.
   * Format is "mimeType:/path" (e.g., "image/svg+xml:/favicon.svg").
   */
  protected buildFaviconTag(favicon: string | undefined): string | undefined {
    if (!favicon) {
      return undefined;
    }
    const colonIndex = favicon.indexOf(":");
    if (colonIndex === -1) {
      return undefined;
    }
    const type = favicon.slice(0, colonIndex);
    const href = favicon.slice(colonIndex + 1);
    return `<link rel="icon" type="${type}" href="${href}">`;
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
   * Resolve the static file pattern from page options.
   * Returns a compiled RegExp, or `false` if disabled (empty string).
   */
  protected resolveStaticFilePattern(): RegExp | false {
    const pattern = this.pageOptions.staticFilePattern;
    if (!pattern) return false;
    return new RegExp(pattern);
  }

  /**
   * Collect middleware from the entire parent chain + the page itself.
   * Parent middleware runs first (outermost → innermost → page).
   */
  protected collectMiddleware(page: PageRoute): Middleware[] {
    const chain: Middleware[][] = [];
    let current: PageRoute | undefined = page;

    while (current) {
      if (current.use?.length) {
        chain.unshift(current.use);
      }
      current = current.parent;
    }

    return chain.flat();
  }

  /**
   * Create the request handler for a page route.
   *
   * When cacheMiddleware is provided, uses a non-streaming path that renders
   * to a string so the result can be cached. Otherwise uses early HTML streaming.
   */
  protected createHandler(
    route: PageRoute,
    cacheMiddleware: Middleware[] = [],
  ): ServerHandler {
    const hasCache = cacheMiddleware.length > 0;
    const isCatchAll = route.match === "/*";
    const staticFilePattern = isCatchAll
      ? this.resolveStaticFilePattern()
      : false;

    return async (serverRequest) => {
      const { url, reply, query, params } = serverRequest;

      // Skip SSR for file-like URLs hitting the catch-all wildcard.
      // Bots and crawlers often probe paths like /hello.txt, /wp-login.php, etc.
      // Rendering a full React page for these is wasteful — return a plain 404 instead.
      // biome-ignore lint/complexity/useOptionalChain: staticFilePattern is `false | RegExp`; optional chaining doesn't narrow `false`
      if (staticFilePattern && staticFilePattern.test(url.pathname)) {
        reply.status = 404;
        reply.headers["content-type"] = "text/plain";
        return "Not Found";
      }

      this.log.trace("Rendering page", { name: route.name });

      // Locale-prefix mode: the URL is the source of truth for language.
      // Record the active locale so links built during SSR (`pathname()`)
      // carry the prefix, and so hreflang alternates can be emitted.
      if (this.localeProvider.enabled) {
        this.localeProvider.current = this.localeProvider.detect(
          url.pathname,
        ).locale;
      }

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
            // `user` is declaration-merged onto `ServerRequest` by
            // `alepha/security`, which react cannot import — an optional
            // module must not become a compile-time dependency of the router.
            // Same pattern as `$topic`'s mqtt cast; the field is real, react
            // just cannot see it.
            user: (serverRequest as any).user,
            authorization: serverRequest.headers.authorization,
          }),
        );
      }

      // Route access control is enforced by `use: [$secure(...)]` middleware
      // in the loader pipeline (below). `$page.can` is a UI-only nav gate
      // (sidebar visibility / disabled state) and is intentionally NOT consulted
      // here — it has no server-side permission context to evaluate against.

      await this.alepha.events.emit("react:server:render:begin", {
        request: serverRequest,
        state,
      });

      // Apply SSR headers early
      Object.assign(reply.headers, this.SSR_HEADERS);

      if (hasCache) {
        // When $cache middleware is present, render to string so the result
        // is serializable. Streaming is not compatible with $cache since
        // ReadableStream cannot be serialized/deserialized.
        const renderFn = async (
          _url: string,
        ): Promise<{ html: string; redirect?: string }> => {
          const { redirect, reactStream } = await this.renderPage(route, state);
          if (redirect) {
            return { redirect, html: "" };
          }
          const htmlStream = this.templateProvider.createHtmlStream(
            reactStream!,
            state,
            { hydration: true },
          );
          return { html: await this.streamToString(htmlStream) };
        };

        const result = await new PipelineHandler(renderFn, cacheMiddleware).run(
          url.href,
        );

        if (result.redirect) {
          reply.status = 302;
          reply.headers.location = result.redirect;
          return;
        }

        route.onServerResponse?.(serverRequest);
        reply.body = result.html;
        return;
      }

      // Resolve global head for early streaming (htmlAttributes only)
      let globalHead = this.serverHeadProvider.resolveGlobalHead();

      // In locale-prefix mode the language is known from the URL before any
      // rendering, so stamp the correct `<html lang>` onto the early head
      // (per-request copy — never mutate the shared global head).
      if (this.localeProvider.enabled) {
        globalHead = {
          ...globalHead,
          htmlAttributes: {
            ...globalHead?.htmlAttributes,
            lang: this.localeProvider.current,
          },
        };
      }

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
          state,
          onError: (error) => {
            if (error instanceof Redirection) {
              this.log.debug("Streaming resulted in redirection", {
                redirect: error.redirect,
              });
              // Can't do redirect after streaming started - already handled above
            } else {
              // disable logging here, it's noisy and duplicate
              // this.log.error("HTML stream error", error);
            }
          },
        },
      );

      this.log.trace("Page streaming started (early head optimization)");
      route.onServerResponse?.(serverRequest);
      reply.body = htmlStream.pipeThrough(
        new TransformStream({
          flush: () => {
            this.log.info("Page streaming completed", { name: route.name });
          },
        }),
      );
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
  /**
   * Inject SEO `hreflang` alternate links for the current route when
   * locale-prefix routing is enabled. Each registered locale gets an absolute
   * alternate URL (the default locale stays unprefixed), plus an `x-default`
   * pointing at the unprefixed URL — this is what lets crawlers index every
   * language. Also sets a best-effort `<html lang>` for the non-streaming /
   * prerender path; the streamed path's `<html lang>` is finalized on the
   * client (the early HTML head is flushed before the route is known).
   *
   * No-op unless `routing: "prefix"` is enabled on the i18n module.
   */
  protected injectLocaleHead(state: ReactRouterState): void {
    if (!this.localeProvider.enabled) {
      return;
    }

    const { origin, search } = state.url;
    const canonical = this.localeProvider.detect(state.url.pathname).pathname;

    const links = this.localeProvider.locales.map((locale) => ({
      rel: "alternate",
      hreflang: locale,
      href: `${origin}${this.localeProvider.withPrefix(canonical, locale)}${search}`,
    }));
    links.push({
      rel: "alternate",
      hreflang: "x-default",
      href: `${origin}${canonical}${search}`,
    });

    state.head ??= {};
    state.head.link = [...(state.head.link ?? []), ...links];
    state.head.htmlAttributes = {
      ...state.head.htmlAttributes,
      lang: this.localeProvider.current,
    };
  }

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

    // Inject SEO hreflang alternates for locale-prefix routing
    this.injectLocaleHead(state);

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
          // disable logging here, it's noisy and duplicate
          // this.log.error("Streaming render error", error);
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

    // Render page and collect the stream into a serializable result.
    // This must happen inside the middleware pipeline so that $cache
    // wraps a function returning { html, redirect? } — not a ReadableStream.
    // The URL string is passed as argument so middleware like $cache can
    // derive a unique cache key per URL (params + query).
    const renderFn = async (
      _url: string,
    ): Promise<{
      html: string;
      redirect?: string;
    }> => {
      const { redirect, reactStream } = await this.renderPage(page, state);
      if (redirect) {
        return { redirect, html: "" };
      }

      if (!options.html) {
        return { html: await this.streamToString(reactStream!) };
      }

      const htmlStream = this.templateProvider.createHtmlStream(
        reactStream!,
        state,
        { hydration: options.hydration ?? true },
      );
      return { html: await this.streamToString(htmlStream) };
    };

    const allMiddleware = this.collectMiddleware(page);
    const result = allMiddleware.length
      ? await new PipelineHandler(renderFn, allMiddleware).run(url.href)
      : await renderFn(url.href);

    if (result.redirect) {
      return { state, html: "", redirect: result.redirect };
    }

    await this.alepha.events.emit("react:server:render:end", {
      state,
      html: result.html,
    });

    return { state, html: result.html };
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

const envSchema = z.object({
  REACT_SSR_ENABLED: z
    .boolean()
    .describe(
      "Enable or disable server-side rendering (SSR) for React pages. When set to false, pages are rendered client-side only.",
    )
    .optional(),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof envSchema>> {}
  interface State {
    "alepha.react.server.ssr"?: boolean;
  }
}

/**
 * React server provider configuration atom
 */
/**
 * Default pattern matching file-like URLs (e.g. /hello.txt, /wp-login.php).
 * Matches paths whose last segment contains a dot followed by 1-10 alphanumeric characters.
 */
export const DEFAULT_STATIC_FILE_PATTERN = "\\.[a-zA-Z0-9]{1,10}$";

export const reactServerOptions = $atom({
  name: "alepha.react.server.options",
  schema: z.object({
    publicDir: z.string(),
    staticServer: z.object({
      disabled: z.boolean(),
      path: z.string().describe("URL path where static files will be served."),
    }),
  }),
  default: {
    publicDir: "public",
    staticServer: {
      disabled: false,
      path: "/",
    },
  },
  serverOnly: true,
});

export type ReactServerProviderOptions = Infer<
  typeof reactServerOptions.schema
>;

declare module "alepha" {
  interface State {
    [reactServerOptions.key]: ReactServerProviderOptions;
  }
}
