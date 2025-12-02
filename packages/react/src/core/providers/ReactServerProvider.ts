import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  $atom,
  $env,
  $hook,
  $inject,
  $use,
  Alepha,
  AlephaError,
  type Static,
  t,
} from "alepha";
import { $logger } from "alepha/logger";
import {
  type ServerHandler,
  ServerProvider,
  ServerRouterProvider,
  ServerTimingProvider,
} from "alepha/server";
import { ServerLinksProvider } from "alepha/server/links";
import { ServerStaticProvider } from "alepha/server/static";
import { renderToString } from "react-dom/server";
import {
  $page,
  type PagePrimitiveRenderOptions,
  type PagePrimitiveRenderResult,
} from "../primitives/$page.ts";
import { Redirection } from "../errors/Redirection.ts";
import type { ReactHydrationState } from "./ReactBrowserProvider.ts";
import {
  type PageRoute,
  ReactPageProvider,
  type ReactRouterState,
} from "./ReactPageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  REACT_SSR_ENABLED: t.optional(t.boolean()),
  REACT_ROOT_ID: t.text({ default: "root" }), // TODO: move to ReactPageProvider.options?
  REACT_SERVER_TEMPLATE: t.optional(
    t.text({
      size: "rich",
    }),
  ),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
  interface State {
    "alepha.react.server.ssr"?: boolean;
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

export class ReactServerProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly pageApi = $inject(ReactPageProvider);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly serverStaticProvider = $inject(ServerStaticProvider);
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly serverTimingProvider = $inject(ServerTimingProvider);

  public readonly ROOT_DIV_REGEX = new RegExp(
    `<div([^>]*)\\s+id=["']${this.env.REACT_ROOT_ID}["']([^>]*)>(.*?)<\\/div>`,
    "is",
  );
  protected preprocessedTemplate: PreprocessedTemplate | null = null;

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
      this.alepha.env.REACT_SERVER_TEMPLATE ??
      "<!DOCTYPE html><html lang='en'><head></head><body></body></html>"
    );
  }

  protected async registerPages(templateLoader: TemplateLoader) {
    // Preprocess template once
    const template = await templateLoader();
    if (template) {
      this.preprocessedTemplate = this.preprocessTemplate(template);
    }

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

    this.log.info("SSR (dev) OK");

    const url = `http://${process.env.SERVER_HOST}:${process.env.SERVER_PORT}`;

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
    const html = this.renderToHtml(template, state, options.hydration);

    if (html instanceof Redirection) {
      return { state, html: "", redirect };
    }

    const result = {
      state,
      html,
    };

    await this.alepha.events.emit("react:server:render:end", result);

    return result;
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

      if (this.alepha.has(ServerLinksProvider)) {
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

      reply.headers["content-type"] = "text/html";

      // by default, disable caching for SSR responses
      // some plugins may override this
      reply.headers["cache-control"] =
        "no-store, no-cache, must-revalidate, proxy-revalidate";
      reply.headers.pragma = "no-cache";
      reply.headers.expires = "0";

      const html = this.renderToHtml(template, state);
      if (html instanceof Redirection) {
        reply.redirect(
          typeof html.redirect === "string"
            ? html.redirect
            : this.pageApi.href(html.redirect),
        );
        this.log.debug("Rendering resulted in redirection", {
          redirect: html.redirect,
        });
        return;
      }

      this.log.trace("Page rendered to HTML successfully");

      const event = {
        request: serverRequest,
        state,
        html,
      };

      await this.alepha.events.emit("react:server:render:end", event);

      route.onServerResponse?.(serverRequest);

      this.log.trace("Page rendered", {
        name: route.name,
      });

      return event.html;
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
      const { request, context, ...store } =
        this.alepha.context.als?.getStore() ?? {}; /// TODO: als must be protected, find a way to iterate on alepha.state

      const hydrationData: ReactHydrationState = {
        ...store,
        // map react.router.state to the hydration state
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

      // create hydration data
      const script = `<script>window.__ssr=${JSON.stringify(hydrationData)}</script>`;

      // inject app into template
      this.fillTemplate(response, app, script);
    }

    return response.html;
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
