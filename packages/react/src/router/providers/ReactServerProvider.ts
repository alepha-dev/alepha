import { existsSync } from "node:fs";
import { join } from "node:path";
import { $atom, $env, $hook, $inject, $use, Alepha, AlephaError, type Static, t, } from "alepha";
import { $logger } from "alepha/logger";
import { type ServerHandler, ServerRouterProvider, ServerTimingProvider, } from "alepha/server";
import { ServerLinksProvider } from "alepha/server/links";
import { ServerStaticProvider } from "alepha/server/static";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { ServerHeadProvider } from "@alepha/react/head";
import { Redirection } from "../errors/Redirection.ts";
import { $page, type PagePrimitiveRenderOptions, type PagePrimitiveRenderResult, } from "../primitives/$page.ts";
import type { ReactHydrationState } from "./ReactBrowserProvider.ts";
import { type PageRoute, ReactPageProvider, type ReactRouterState, } from "./ReactPageProvider.ts";
import { SSRManifestProvider } from "./SSRManifestProvider.ts";
import { PAGE_PRELOAD_KEY } from "../constants/PAGE_PRELOAD_KEY.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  REACT_SSR_ENABLED: t.optional(t.boolean()),
  REACT_SSR_STREAMING: t.optional(t.boolean()),
  REACT_ROOT_ID: t.text({ default: "root" }), // TODO: move to ReactPageProvider.options?
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
  interface State {
    "alepha.react.server.ssr"?: boolean;
    "alepha.react.server.streaming"?: boolean;
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

// ---------------------------------------------------------------------------------------------------------------------

/**
 * React server provider responsible for SSR and static file serving.
 *
 * Use `react-dom/server` under the hood.
 */
export class ReactServerProvider {
  /**
   * Shared TextEncoder instance - reused across all requests to avoid allocation.
   */
  protected readonly encoder = new TextEncoder();

  /**
   * SSR response headers - pre-allocated to avoid object creation per request.
   */
  protected readonly SSR_HEADERS = {
    "content-type": "text/html",
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    pragma: "no-cache",
    expires: "0",
  } as const;

  /**
   * Pre-encoded hydration script parts - avoids string encoding on every request.
   */
  protected readonly HYDRATION_SCRIPT_PREFIX = this.encoder.encode(
    "<script>window.__ssr=",
  );
  protected readonly HYDRATION_SCRIPT_SUFFIX = this.encoder.encode("</script>");

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly pageApi = $inject(ReactPageProvider);
  protected readonly serverHeadProvider = $inject(ServerHeadProvider);
  protected readonly serverStaticProvider = $inject(ServerStaticProvider);
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly serverTimingProvider = $inject(ServerTimingProvider);
  protected readonly ssrManifestProvider = $inject(SSRManifestProvider);

  public readonly ROOT_DIV_REGEX = new RegExp(
    `<div([^>]*)\\s+id=["']${this.env.REACT_ROOT_ID}["']([^>]*)>(.*?)<\\/div>`,
    "is",
  );
  protected preprocessedTemplate: PreprocessedTemplate | null = null;
  protected preprocessedTemplateBytes: PreprocessedTemplateBytes | null = null;

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

      const streamingEnabled =
        this.alepha.store.get("alepha.react.server.streaming") ??
        (ssrEnabled && this.env.REACT_SSR_STREAMING === true);

      this.alepha.store.set("alepha.react.server.ssr", ssrEnabled);
      this.alepha.store.set("alepha.react.server.streaming", streamingEnabled);

      if (streamingEnabled) {
        this.log.info("SSR streaming enabled");
      }

      // development mode
      if (this.alepha.isViteDev()) {
        await this.configureVite(ssrEnabled);
        return;
      }

      // production mode
      let root = "";

      // non-serverless mode only -> serve static files
      if (!this.alepha.isServerless()) {
        root = this.getPublicDirectory();
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

  public get template() {
    return (
      this.alepha.store.get("alepha.react.server.template") ??
      "<!DOCTYPE html><html lang='en'><head></head><body></body></html>"
    );
  }

  protected async registerPages(templateLoader: TemplateLoader) {
    // Preprocess template once and pre-encode to bytes for streaming
    const template = await templateLoader();
    if (template) {
      this.preprocessedTemplate = this.preprocessTemplate(template);
      // Pre-encode template parts to Uint8Array for zero-copy streaming
      this.preprocessedTemplateBytes = {
        beforeApp: this.encoder.encode(this.preprocessedTemplate.beforeApp),
        afterApp: this.encoder.encode(this.preprocessedTemplate.afterApp),
        afterScript: this.encoder.encode(this.preprocessedTemplate.afterScript),
      };
    }

    // Cache ServerLinksProvider check at startup
    this.hasServerLinksProvider = this.alepha.has(ServerLinksProvider);

    for (const page of this.pageApi.getPages()) {
      if (page.component || page.lazy) {
        this.log.debug(`+ ${page.match} -> ${page.name}`);

        this.serverRouterProvider.createRoute({
          ...page,
          schema: undefined, // schema is handled by the page primitive provider for now (shared by browser and server)
          method: "GET",
          path: page.match,
          handler: this.createHandler(page, templateLoader),
        });
      }
    }
  }

  /**
   * Get the public directory path where static files are located.
   */
  protected getPublicDirectory(): string {
    const maybe = [
      join(process.cwd(), `dist/${this.options.publicDir}`),
      join(process.cwd(), this.options.publicDir),
    ];

    for (const it of maybe) {
      if (existsSync(it)) {
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
   * Configure Vite for SSR.
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
   * For testing purposes, creates a render function that can be used.
   */
  public async render(
    name: string,
    options: PagePrimitiveRenderOptions = {},
  ): Promise<PagePrimitiveRenderResult> {
    const page = this.pageApi.page(name);
    const url = new URL(this.pageApi.url(name, options));
    const entry: Partial<ReactRouterState> = {
      url,
      params: options.params ?? {},
      query: options.query ?? {},
      onError: () => null,
      layers: [],
      meta: {},
    };
    const state = entry as ReactRouterState;

    this.log.trace("Rendering", {
      url,
    });

    await this.alepha.events.emit("react:server:render:begin", {
      state,
    });

    const { redirect } = await this.pageApi.createLayers(
      page,
      state as ReactRouterState,
    );

    if (redirect) {
      return { state, html: "", redirect };
    }

    if (!options.html) {
      this.alepha.store.set("alepha.react.router.state", state);

      return {
        state,
        html: renderToString(this.pageApi.root(state)),
      };
    }

    const template = this.template ?? "";
    let html = this.renderToHtml(template, state, options.hydration);

    if (html instanceof Redirection) {
      return { state, html: "", redirect };
    }

    // Fill head state from route configurations and render into HTML
    this.serverHeadProvider.fillHead(state);
    if (state.head && Object.keys(state.head).length > 0) {
      html = this.serverHeadProvider.renderHead(html, state.head);
    }

    await this.alepha.events.emit("react:server:render:end", {
      state,
      html,
    });

    return {
      state,
      html,
    };
  }

  protected createHandler(
    route: PageRoute,
    templateLoader: TemplateLoader,
  ): ServerHandler {
    return async (serverRequest) => {
      const { url, reply, query, params } = serverRequest;
      const template = await templateLoader();
      if (!template) {
        throw new AlephaError("Missing template for SSR rendering");
      }

      this.log.trace("Rendering page", {
        name: route.name,
      });

      const entry: Partial<ReactRouterState> = {
        url,
        params,
        query,
        onError: () => null,
        layers: [],
      };

      const state = entry as ReactRouterState;

      state.name = route.name;

      if (this.hasServerLinksProvider) {
        this.alepha.store.set(
          "alepha.server.request.apiLinks",
          await this.alepha.inject(ServerLinksProvider).getUserApiLinks({
            user: (serverRequest as any).user, // TODO: fix type
            authorization: serverRequest.headers.authorization,
          }),
        );
      }

      let target: PageRoute | undefined = route; // TODO: move to PagePrimitiveProvider
      while (target) {
        if (route.can && !route.can()) {
          this.log.warn(
            `Access to page '${route.name}' is forbidden by can() check`,
          )
          // if the page is not accessible, return 403
          reply.status = 403;
          reply.headers["content-type"] = "text/plain";
          return "Forbidden";
        }
        target = target.parent;
      }

      // TODO: SSR strategies
      // - only when googlebot
      // - only child pages
      // if (page.client) {
      // 	// if the page is a client-only page, return 404
      // 	reply.status = 200;
      // 	reply.headers["content-type"] = "text/html";
      // 	reply.body = template;
      // 	return;
      // }

      await this.alepha.events.emit("react:server:render:begin", {
        request: serverRequest,
        state,
      });

      this.serverTimingProvider.beginTiming("createLayers");

      const { redirect } = await this.pageApi.createLayers(route, state);

      this.serverTimingProvider.endTiming("createLayers");

      if (redirect) {
        this.log.debug("Resolver resulted in redirection", {
          redirect,
        });
        return reply.redirect(redirect);
      }

      // Apply static SSR headers (content-type, cache-control, pragma, expires)
      Object.assign(reply.headers, this.SSR_HEADERS);

      // Use streaming if enabled, otherwise fall back to sync render
      const streamingEnabled = this.alepha.store.get(
        "alepha.react.server.streaming",
      );

      if (streamingEnabled) {
        // Pre-compute head from route config before streaming starts
        // (useHead() during render won't be captured - only route-defined head)
        this.serverHeadProvider.fillHead(state);

        // Collect and inject modulepreload links for lazy-loaded route chunks
        const preloadLinks = this.collectPreloadLinks(route);
        if (preloadLinks.length > 0) {
          state.head ??= {};
          state.head.link = [...(state.head.link ?? []), ...preloadLinks];
        }

        // Inject head into template if head data exists
        let streamTemplate = template;
        if (state.head && Object.keys(state.head).length > 0) {
          streamTemplate = this.serverHeadProvider.renderHead(
            template,
            state.head,
          );
        }

        const result = await this.renderToStream(streamTemplate, state);

        if (result instanceof Redirection) {
          reply.redirect(
            result.redirect
          );
          this.log.debug("Streaming resulted in redirection", {
            redirect: result.redirect,
          });
          return;
        }

        this.log.trace("Page streaming started");

        route.onServerResponse?.(serverRequest);

        // Set stream as response body
        reply.body = result;
        return;
      }

      // Sync render path (default)
      let html = this.renderToHtml(template, state);
      if (html instanceof Redirection) {
        reply.redirect(
          html.redirect
        );
        this.log.debug("Rendering resulted in redirection", {
          redirect: html.redirect,
        });
        return;
      }

      this.log.trace("Page rendered to HTML successfully");

      // Fill head state from route configurations and render into HTML
      this.serverTimingProvider.beginTiming("renderHead");
      this.serverHeadProvider.fillHead(state);
      if (state.head && Object.keys(state.head).length > 0) {
        html = this.serverHeadProvider.renderHead(html, state.head);
      }
      this.serverTimingProvider.endTiming("renderHead");

      await this.alepha.events.emit("react:server:render:end", {
        request: serverRequest,
        state,
        html,
      });

      route.onServerResponse?.(serverRequest);

      this.log.trace("Page rendered", {
        name: route.name,
      });

      return html;
    };
  }

  public renderToHtml(
    template: string,
    state: ReactRouterState,
    hydration = true,
  ): string | Redirection {
    const element = this.pageApi.root(state);

    // attach react router state to the http request context
    this.alepha.store.set("alepha.react.router.state", state);

    this.serverTimingProvider.beginTiming("renderToString");
    let app = "";
    try {
      app = renderToString(element);
    } catch (error) {
      this.log.error(
        "renderToString has failed, fallback to error handler",
        error,
      );
      const element = state.onError(error as Error, state);
      if (element instanceof Redirection) {
        // if the error is a redirection, return the redirection URL
        return element;
      }

      app = renderToString(element);
      this.log.debug("Error handled successfully with fallback");
    }
    this.serverTimingProvider.endTiming("renderToString");

    const response = {
      html: template,
    };

    if (hydration) {
      const script = this.buildHydrationScript(state);
      this.fillTemplate(response, app, script);
    }

    return response.html;
  }

  /**
   * Render React element to a Web Stream for progressive HTML delivery.
   *
   * Benefits over renderToString:
   * - Faster TTFB: Initial HTML (<head>) sent BEFORE React renders
   * - Progressive rendering: Content appears as it's rendered
   * - Lower memory: Chunks are GC'd as they're sent
   *
   * Key insight: We send <head> BEFORE calling renderToReadableStream,
   * so browser can start downloading JS/CSS while React is still rendering.
   *
   * @param template - HTML template to inject React content into
   * @param state - React router state with layers and params
   * @param hydration - Whether to include hydration script (default: true)
   * @returns ReadableStream of HTML chunks, or Redirection if redirect detected
   */
  public async renderToStream(
    template: string,
    state: ReactRouterState,
    hydration = true,
  ): Promise<ReadableStream<Uint8Array> | Redirection> {
    const element = this.pageApi.root(state);

    // Attach react router state to the http request context
    this.alepha.store.set("alepha.react.router.state", state);

    // Determine template bytes to use
    let templateBytes: PreprocessedTemplateBytes;

    const hasHeadData = state.head && Object.keys(state.head).length > 0;

    if (hasHeadData) {
      const preprocessed = this.preprocessTemplate(template);
      templateBytes = {
        beforeApp: this.encoder.encode(preprocessed.beforeApp),
        afterApp: this.encoder.encode(preprocessed.afterApp),
        afterScript: this.encoder.encode(preprocessed.afterScript),
      };
    } else {
      if (!this.preprocessedTemplate) {
        this.preprocessedTemplate = this.preprocessTemplate(template);
        this.preprocessedTemplateBytes = {
          beforeApp: this.encoder.encode(this.preprocessedTemplate.beforeApp),
          afterApp: this.encoder.encode(this.preprocessedTemplate.afterApp),
          afterScript: this.encoder.encode(this.preprocessedTemplate.afterScript),
        };
      }
      templateBytes = this.preprocessedTemplateBytes!;
    }

    this.serverTimingProvider.beginTiming("renderToStream");

    // Create a custom ReadableStream that sends <head> IMMEDIATELY,
    // then waits for React to render, then streams React content.
    // This ensures browser starts downloading assets before React finishes.
    const encoder = this.encoder;
    const log = this.log;
    const timing = this.serverTimingProvider;
    const buildHydrationData = () => this.buildHydrationData(state);
    const safeJsonSerialize = (data: unknown) => this.safeJsonSerialize(data);
    const HYDRATION_SCRIPT_PREFIX = this.HYDRATION_SCRIPT_PREFIX;
    const HYDRATION_SCRIPT_SUFFIX = this.HYDRATION_SCRIPT_SUFFIX;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        // 1. IMMEDIATELY send beforeApp (<head> with JS/CSS links)
        //    Browser can start downloading assets NOW, before React renders
        controller.enqueue(templateBytes.beforeApp);

        try {
          await new Promise((r) => setTimeout(r, 0)); // yield to ensure head is sent

          // 2. Wait for React to render the shell
          //    Note: This blocks until shell is ready, but <head> is already sent!
          const reactStream = await renderToReadableStream(element, {
            onError: (error: unknown) => {
              if (error instanceof Redirection) {
                log.warn("Redirect during streaming ignored", {
                  redirect: error.redirect,
                });
              } else {
                log.error("Streaming render error", error);
              }
            },
          });

          // 3. Stream React content as it becomes available
          const reader = reactStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }

          // 4. Send closing div tag
          controller.enqueue(templateBytes.afterApp);

          // 5. Inject hydration script
          if (hydration) {
            controller.enqueue(HYDRATION_SCRIPT_PREFIX);
            controller.enqueue(encoder.encode(safeJsonSerialize(buildHydrationData())));
            controller.enqueue(HYDRATION_SCRIPT_SUFFIX);
          }

          // 6. Send closing tags
          controller.enqueue(templateBytes.afterScript);

          timing.endTiming("renderToStream");
          controller.close();
        } catch (error) {
          timing.endTiming("renderToStream");

          if (error instanceof Redirection) {
            // Can't redirect after we've started streaming - close with what we have
            log.warn("Redirect during shell render - stream already started");
            controller.enqueue(templateBytes.afterApp);
            controller.enqueue(templateBytes.afterScript);
            controller.close();
          } else {
            log.error("Shell render failed", error);
            // Send error message in the stream
            controller.enqueue(encoder.encode(`<p>Render error</p>`));
            controller.enqueue(templateBytes.afterApp);
            controller.enqueue(templateBytes.afterScript);
            controller.close();
          }
        }
      },
    });
  }

  /**
   * Just a safe JSON serializer to prevent XSS attacks.
   */
  protected safeJsonSerialize(data: unknown): string {
    return JSON.stringify(data)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
  }

  /**
   * Build hydration data from current state.
   * Extracted for reuse in both sync and streaming render paths.
   */
  protected buildHydrationData(state: ReactRouterState): ReactHydrationState {
    const { request, context, ...store } =
      this.alepha.context.als?.getStore() ?? {};

    return {
      ...store,
      "alepha.react.router.state": undefined,
      layers: state.layers.map((it) => ({
        ...it,
        error: it.error
          ? {
              ...it.error,
              name: it.error.name,
              message: it.error.message,
              stack: !this.alepha.isProduction() ? it.error.stack : undefined,
            }
          : undefined,
        index: undefined,
        path: undefined,
        element: undefined,
        route: undefined,
      })),
    };
  }

  /**
   * Build the hydration script tag.
   */
  protected buildHydrationScript(state: ReactRouterState): string {
    const hydrationData = this.buildHydrationData(state);
    return `<script>window.__ssr=${this.safeJsonSerialize(hydrationData)}</script>`;
  }

  /**
   * Collect modulepreload links for a route and its parent chain.
   *
   * Walks up the route tree and collects preload links for all lazy-loaded
   * components using the SSR manifest.
   *
   * @param route - The page route to collect preloads for
   * @returns Array of link objects for head injection
   */
  protected collectPreloadLinks(
    route: PageRoute,
  ): Array<{ rel: string; href: string; as?: string }> {
    if (!this.ssrManifestProvider.isAvailable()) {
      return [];
    }

    const preloadPaths: string[] = [];
    let current: PageRoute | undefined = route;

    // Walk up the route chain and collect all preload paths
    while (current) {
      const preloadPath = current[PAGE_PRELOAD_KEY];
      if (preloadPath) {
        preloadPaths.push(preloadPath);
      }
      current = current.parent;
    }

    if (preloadPaths.length === 0) {
      return [];
    }

    // Get all chunks for these paths (deduplicated)
    const chunks = this.ssrManifestProvider.getChunksForMultiple(preloadPaths);

    // Convert to link objects
    return chunks.map((href) => {
      if (href.endsWith(".css")) {
        return { rel: "preload", href, as: "style" };
      }
      return { rel: "modulepreload", href };
    });
  }

  protected preprocessTemplate(template: string): PreprocessedTemplate {
    // Find the body close tag for script injection
    const bodyCloseMatch = template.match(/<\/body>/i);
    const bodyCloseIndex = bodyCloseMatch?.index ?? template.length;

    const beforeScript = template.substring(0, bodyCloseIndex);
    const afterScript = template.substring(bodyCloseIndex);

    // Check if there's an existing root div
    const rootDivMatch = beforeScript.match(this.ROOT_DIV_REGEX);

    if (rootDivMatch) {
      // Split around the existing root div content
      const beforeDiv = beforeScript.substring(0, rootDivMatch.index!);
      const afterDivStart = rootDivMatch.index! + rootDivMatch[0].length;
      const afterDiv = beforeScript.substring(afterDivStart);

      const beforeApp = `${beforeDiv}<div${rootDivMatch[1]} id="${this.env.REACT_ROOT_ID}"${rootDivMatch[2]}>`;
      const afterApp = `</div>${afterDiv}`;

      return { beforeApp, afterApp, beforeScript: "", afterScript };
    }

    // No existing root div, find body tag to inject new div
    const bodyMatch = beforeScript.match(/<body([^>]*)>/i);
    if (bodyMatch) {
      const beforeBody = beforeScript.substring(
        0,
        bodyMatch.index! + bodyMatch[0].length,
      );
      const afterBody = beforeScript.substring(
        bodyMatch.index! + bodyMatch[0].length,
      );

      const beforeApp = `${beforeBody}<div id="${this.env.REACT_ROOT_ID}">`;
      const afterApp = `</div>${afterBody}`;

      return { beforeApp, afterApp, beforeScript: "", afterScript };
    }

    // Fallback: no body tag found, just wrap everything
    return {
      beforeApp: `<div id="${this.env.REACT_ROOT_ID}">`,
      afterApp: `</div>`,
      beforeScript,
      afterScript,
    };
  }

  protected fillTemplate(
    response: { html: string },
    app: string,
    script: string,
  ) {
    if (!this.preprocessedTemplate) {
      // Fallback to old logic if preprocessing failed
      this.preprocessedTemplate = this.preprocessTemplate(response.html);
    }

    // Pure concatenation - no regex replacements needed
    response.html =
      this.preprocessedTemplate.beforeApp +
      app +
      this.preprocessedTemplate.afterApp +
      script +
      this.preprocessedTemplate.afterScript;
  }
}

type TemplateLoader = () => Promise<string | undefined>;

interface PreprocessedTemplate {
  beforeApp: string;
  afterApp: string;
  beforeScript: string;
  afterScript: string;
}

/**
 * Pre-encoded template parts as Uint8Array for zero-copy streaming.
 */
interface PreprocessedTemplateBytes {
  beforeApp: Uint8Array;
  afterApp: Uint8Array;
  afterScript: Uint8Array;
}
