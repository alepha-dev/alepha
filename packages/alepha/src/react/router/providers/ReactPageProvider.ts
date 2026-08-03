import {
  $atom,
  $hook,
  $inject,
  $store,
  Alepha,
  AlephaError,
  coerceObject,
  OPTIONS,
  PipelineHandler,
  type ZType,
  z,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { AlephaContext, ClientOnly } from "alepha/react";
import type { Head } from "alepha/react/head";
import { currentUserAtom } from "alepha/security";
import { createElement, type ReactNode, StrictMode } from "react";
import ErrorViewer from "../components/ErrorViewer.tsx";
import NestedView from "../components/NestedView.tsx";
import NotFoundPage from "../components/NotFound.tsx";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import { Redirection } from "../errors/Redirection.ts";
import {
  $page,
  type ErrorHandler,
  type PagePrimitive,
  type PagePrimitiveOptions,
} from "../primitives/$page.ts";
import { RootComponentsProvider } from "./RootComponentsProvider.ts";
import { RouterLocaleProvider } from "./RouterLocaleProvider.ts";

// -------------------------------------------------------------------------------------------------------------------

export const reactPageOptions = $atom({
  name: "alepha.react.page.options",
  description: "Configuration options for the React page provider.",
  schema: z.object({
    /**
     * Enable React StrictMode wrapper.
     */
    strictMode: z.boolean().default(true),
    /**
     * RegExp pattern (as string) to detect file-like URLs (e.g. /hello.txt, /wp-login.php).
     * When a request hits the catch-all wildcard route and matches this pattern,
     * SSR is skipped and a plain 404 response is returned instead.
     *
     * Set to empty string to disable this behavior.
     *
     * @default "\\.[a-zA-Z0-9]{1,10}$"
     */
    staticFilePattern: z.string(),
  }),
  default: {
    strictMode: true,
    staticFilePattern: "\\.[a-zA-Z0-9]{1,10}$",
  },
});

// -------------------------------------------------------------------------------------------------------------------

/**
 * Handle page routes for React applications. (Browser and Server)
 */
export class ReactPageProvider {
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly options = $store(reactPageOptions);
  protected readonly alepha = $inject(Alepha);
  protected readonly rootComponentsProvider = $inject(RootComponentsProvider);
  protected readonly localeProvider = $inject(RouterLocaleProvider);
  protected readonly pages: PageRoute[] = [];
  protected nextIdCursor = 0;

  protected readonly configure = $hook({
    on: "configure",
    handler: () => {
      let hasNotFoundHandler = false;
      const pages = this.alepha.primitives($page);

      const hasParent = (it: PagePrimitive) => {
        if (it.options.parent) {
          return true;
        }

        for (const page of pages) {
          const children = page.options.children
            ? Array.isArray(page.options.children)
              ? page.options.children
              : page.options.children()
            : [];
          if (children.includes(it)) {
            return true;
          }
        }
      };

      for (const page of pages) {
        if (page.options.path === "/*") {
          hasNotFoundHandler = true;
        }

        this.warnIfGuardedBySecure(page);

        // skip children, we only want root pages
        if (hasParent(page)) {
          continue;
        }

        this.add(this.map(pages, page));
      }

      if (!hasNotFoundHandler && pages.length > 0) {
        // add a default 404 page if not already defined
        this.add({
          path: "/*",
          name: "notFound",
          component: NotFoundPage,
          onServerResponse: ({ reply }) => {
            reply.status = 404;
          },
        });
      }
    },
  });

  /**
   * Warn when a page is guarded with `$secure`, which does less than it looks.
   *
   * `$secure` is a *handler* middleware: on a page it wraps the `loader`, and its
   * browser implementation short-circuits by returning `undefined` rather than
   * throwing. So an unauthorised visitor does not get bounced — the loader is
   * skipped and **the page renders anyway**, with whatever an empty props object
   * produces. On a back office that means the entire shell, navigation and all,
   * over empty tables whose requests each answer 401.
   *
   * That is defensible behaviour for an API middleware reused on a page, and it is
   * indefensible as a silent one: `use: [$secure(...)]` reads exactly like a
   * guard. So say so once, at boot, and name the alternative.
   *
   * A warning rather than an error, because the combination is not wrong — a page
   * may legitimately want its loader skipped for anonymous visitors while still
   * rendering. It is only wrong when mistaken for access control.
   */
  protected warnIfGuardedBySecure(page: PagePrimitive): void {
    const guard = page.options.use?.find(
      (middleware) => (middleware as any)[OPTIONS]?.name === "$secure",
    );

    if (!guard) {
      return;
    }

    this.log.warn(
      `Page '${page.options.path}' uses $secure, which does not prevent it from rendering. ` +
        "$secure wraps the loader and skips it for an unauthorised visitor, so the page still renders without its data. " +
        "To turn a visitor away, throw Redirection from the loader instead; keep $secure on the endpoints underneath, which is what enforces the permission.",
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  public getPages(): PageRoute[] {
    return this.pages;
  }

  public getConcretePages(): ConcretePageRoute[] {
    const pages: ConcretePageRoute[] = [];
    for (const page of this.pages) {
      if (page.children && page.children.length > 0) {
        continue;
      }

      // check if the page has dynamic params
      const fullPath = this.pathname(page.name);
      if (fullPath.includes(":") || fullPath.includes("*")) {
        if (typeof page.static === "object") {
          const entries = page.static.entries;
          if (entries && entries.length > 0) {
            for (const entry of entries) {
              const params = entry.params as Record<string, string>;
              const path = this.compile(page.path ?? "", params);
              if (!path.includes(":") && !path.includes("*")) {
                pages.push({
                  ...page,
                  name: params[Object.keys(params)[0]],
                  staticName: page.name,
                  path,
                  ...entry,
                });
              }
            }
          }
        }

        continue;
      }

      pages.push(page);
    }
    return pages;
  }

  public page(name: string): PageRoute {
    for (const page of this.pages) {
      if (page.name === name) {
        return page;
      }
    }

    throw new AlephaError(`Page '${name}' not found`);
  }

  /**
   * Find a route by name anywhere in the tree (including nested children).
   * Returns undefined if no page with that name exists.
   */
  /**
   * Non-throwing counterpart to {@link page}.
   *
   * Public because callers that hold a possibly-synthetic layer name (the
   * `not-found` layer the router inserts when no route matched) need to ask
   * without being thrown at — `page()` throws for unknown names, so the
   * `?.` in `page(name)?.onLeave?.()` guarded nothing.
   */
  public findRoute(
    name: string,
    routes: PageRouteEntry[] = this.pages,
  ): PageRoute | undefined {
    for (const route of routes as PageRoute[]) {
      if (route.name === name) {
        return route;
      }
      if (route.children?.length) {
        const found = this.findRoute(name, route.children);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  public pathname(
    name: string,
    options: {
      params?: Record<string, string>;
      query?: Record<string, string>;
    } = {},
  ) {
    const page = this.page(name);
    if (!page) {
      throw new AlephaError(`Page ${name} not found`);
    }

    let url = page.path ?? "";
    let parent = page.parent;
    while (parent) {
      url = `${parent.path ?? ""}/${url}`;
      parent = parent.parent;
    }

    url = this.compile(url, options.params ?? {});
    url = url.replace(/\/\/+/g, "/") || "/";

    // Apply the active locale prefix (e.g. `/about` → `/fr/about`) to the path
    // portion only, before any query string is appended. A no-op unless
    // `routing: "prefix"` is enabled on the i18n module.
    url = this.localeProvider.withPrefix(url);

    if (options.query) {
      const query = new URLSearchParams(options.query);
      if (query.toString()) {
        url += `?${query.toString()}`;
      }
    }

    return url;
  }

  public url(
    name: string,
    options: { params?: Record<string, string>; host?: string } = {},
  ): URL {
    return new URL(
      this.pathname(name, options),
      // use provided base or default to http://localhost
      options.host ?? `http://localhost`,
    );
  }

  public root(state: ReactRouterState): ReactNode {
    const root = createElement(
      AlephaContext.Provider,
      { value: this.alepha },
      createElement(NestedView, {}, state.layers[0]?.element),
      ...this.rootComponentsProvider.rootComponents,
    );

    if (this.options.strictMode) {
      return createElement(StrictMode, {}, root);
    }

    return root;
  }

  protected convertStringObjectToObject = (
    schema?: ZType,
    value?: any,
  ): any => {
    if (z.schema.isObject(schema) && typeof value === "object") {
      const shape = z.schema.shape(schema);
      for (const key in shape) {
        // Peel optional/nullable/default wrappers so a field declared as
        // `z.object(...).optional()` is still recognised as an object whose
        // JSON-encoded query value needs parsing.
        const propSchema = z.schema.unwrap(shape[key]);
        if (z.schema.isObject(propSchema) && typeof value[key] === "string") {
          try {
            value[key] = this.alepha.codec.decode(
              propSchema,
              decodeURIComponent(value[key]),
            );
          } catch (e) {
            // ignore
          }
        }
      }
    }
    return value;
  };

  /**
   * Create a new RouterState based on a given route and request.
   * This method resolves the layers for the route, applying any query and params schemas defined in the route.
   * It also handles errors and redirects.
   */
  public async createLayers(
    route: PageRoute,
    state: ReactRouterState,
    previous: PreviousLayerData[] = [],
  ): Promise<CreateLayersResult> {
    let context: Record<string, any> = {}; // all props
    const stack: Array<RouterStackItem> = [{ route }]; // stack of routes

    let parent = route.parent;
    while (parent) {
      stack.unshift({ route: parent });
      parent = parent.parent;
    }

    let forceRefresh = false;

    for (let i = 0; i < stack.length; i++) {
      const it = stack[i];
      const route = it.route;
      const config: Record<string, any> = {};

      try {
        this.convertStringObjectToObject(route.schema?.query, state.query);
        config.query = route.schema?.query
          ? this.alepha.codec.decode(
              route.schema.query,
              // Query params arrive as strings from the URL; coerce declared
              // scalar fields (number/integer/boolean) to their schema type
              // before strict validation, mirroring the HTTP server boundary.
              coerceObject(route.schema.query, state.query),
            )
          : {};
      } catch (e) {
        it.error = e instanceof Error ? e : new Error(String(e));
        break;
      }

      try {
        config.params = route.schema?.params
          ? this.alepha.codec.decode(
              route.schema.params,
              // URL path params arrive as strings; coerce declared scalar
              // fields (number/integer/boolean) to their schema type before
              // strict validation, mirroring `query` above and the HTTP server.
              coerceObject(route.schema.params, state.params),
            )
          : {};
      } catch (e) {
        it.error = e instanceof Error ? e : new Error(String(e));
        break;
      }

      // save config
      it.config = {
        ...config,
      };

      // check if previous layer is the same, reuse if possible
      if (previous?.[i] && !forceRefresh && previous[i].name === route.name) {
        const url = (str?: string) => (str ? str.replace(/\/\/+/g, "/") : "/");

        // The decoded query participates: loaders read `query`, so a
        // query-only navigation (`/search?q=foo` → `/search?q=bar`) must
        // re-run them — reusing the layer would keep stale data on screen
        // and diverge from SSR, which re-runs loaders for the same URL.
        const prev = JSON.stringify({
          part: url(previous[i].part),
          params: previous[i].config?.params ?? {},
          query: previous[i].config?.query ?? {},
        });

        const curr = JSON.stringify({
          part: url(route.path),
          params: config.params ?? {},
          query: config.query ?? {},
        });

        if (prev === curr) {
          // part is the same, reuse previous layer
          it.props = previous[i].props;
          it.error = previous[i].error;
          it.cache = true;
          context = {
            ...context,
            ...it.props,
          };
          continue;
        }

        // part is different, force refresh of next layers
        forceRefresh = true;
      }

      // redirect shorthand
      if (route.redirect) {
        return { redirect: route.redirect };
      }

      // Run this layer's `use` middleware (e.g. $secure) around its loader.
      // Without this, client-side navigation would skip page guards entirely
      // and render protected pages for anyone.
      //
      // Browser-only: on the server, ReactServerProvider already wraps the
      // page handler with the collected middleware chain — running it here
      // too would double-execute it. `$cache` is excluded: like on the
      // server it is handled separately, not as a loader-wrapping middleware.
      const middleware = this.alepha.isBrowser()
        ? (route.use ?? []).filter((m) => m[OPTIONS]?.name !== "$cache")
        : [];

      // Nothing to run for this layer — render a basic view by default.
      if (!route.loader && middleware.length === 0) {
        continue;
      }

      try {
        const args = Object.create(state);
        Object.assign(args, config, context);

        // Terminal handler = the loader (or a no-op when the page has none).
        // `reached` stays false if a guard middleware short-circuits without
        // calling `next` — that is how $secure denies access in the browser.
        let reached = false;
        const terminal = async (a: any) => {
          reached = true;
          return (await route.loader?.(a)) ?? {};
        };

        const props = middleware.length
          ? ((await new PipelineHandler(terminal, middleware).run(args)) ?? {})
          : await terminal(args);

        if (!reached) {
          // A page guard (e.g. $secure) denied access. Distinguish the two
          // cases so the flow is right:
          //  - not authenticated (401) → redirect to the login page,
          //    resolved by the conventional `name: "login"`, carrying the
          //    blocked URL as `?redirect=` so login can return the user.
          //  - authenticated but not allowed (403) → a forbidden error;
          //    redirecting a logged-in user to login would just loop.
          const user = this.alepha.store.get(currentUserAtom);

          if (!user) {
            const login = this.findRoute("login");
            if (login?.match && !/[:*]/.test(login.match)) {
              const back = encodeURIComponent(
                state.url.pathname + state.url.search,
              );
              return { redirect: `${login.match}?redirect=${back}` };
            }
          }

          const denied = new AlephaError(
            user
              ? "You do not have permission to access this page."
              : "Authentication required.",
          );
          (denied as { status?: number }).status = user ? 403 : 401;
          throw denied;
        }

        // save props
        it.props = {
          ...props,
        };

        // add props to context
        context = {
          ...context,
          ...props,
        };
      } catch (e) {
        // check if we need to redirect
        if (e instanceof Redirection) {
          return {
            redirect: e.redirect,
          };
        }

        this.log.error("Page loader has failed", e);

        it.error = e instanceof Error ? e : new Error(String(e));
        break;
      }
    }

    let acc = "";
    for (let i = 0; i < stack.length; i++) {
      const it = stack[i];
      const props = it.props ?? {};

      const params = { ...it.config?.params };
      for (const key of Object.keys(params)) {
        params[key] = String(params[key]);
      }

      acc += "/";
      acc += it.route.path ? this.compile(it.route.path, params) : "";
      const path = acc.replace(/\/+/, "/");
      const localErrorHandler = this.getErrorHandler(it.route);
      if (localErrorHandler) {
        const onErrorParent = state.onError;
        state.onError = (error, context) => {
          const result = localErrorHandler(error, context);
          // if nothing happen, call the parent
          if (result === undefined) {
            return onErrorParent(error, context);
          }
          return result;
        };
      }

      // normal use case
      if (!it.error) {
        try {
          const element = await this.createElement(
            it.route,
            {
              // default props attached to page
              ...(it.route.props ? it.route.props() : {}),
              // resolved props
              ...props,
              // context props (from previous layers)
              ...context,
            },
            state.url,
          );

          state.layers.push({
            name: it.route.name,
            props,
            part: it.route.path,
            config: it.config,
            element: this.renderView(i + 1, path, element, it.route),
            index: i + 1,
            path,
            route: it.route,
            cache: it.cache,
          });
        } catch (e) {
          it.error = e instanceof Error ? e : new Error(String(e));
        }
      }

      // handler has thrown an error, render an error view
      if (it.error) {
        try {
          let element: ReactNode | Redirection | undefined =
            await state.onError(it.error, state);

          if (element === undefined) {
            throw it.error;
          }

          if (element instanceof Redirection) {
            return {
              redirect: element.redirect,
            };
          }

          if (element === null) {
            element = this.renderError(it.error);
          }

          state.layers.push({
            props,
            error: it.error,
            name: it.route.name,
            part: it.route.path,
            config: it.config,
            element: this.renderView(i + 1, path, element, it.route),
            index: i + 1,
            path,
            route: it.route,
            cache: it.cache,
          });
          break;
        } catch (e) {
          if (e instanceof Redirection) {
            return {
              redirect: e.redirect,
            };
          }
          throw e;
        }
      }
    }

    // If the matched leaf opts out of SSR (own value or inherited from
    // parents), wrap the root layer in ClientOnly so the server emits no
    // HTML for the route chain. Loaders have already run above.
    if (state.layers.length > 0 && !this.isSSR(route)) {
      const rootLayer = state.layers[0];
      rootLayer.element = createElement(ClientOnly, {}, rootLayer.element);
    }

    return { state };
  }

  protected getErrorHandler(route: PageRoute): ErrorHandler | undefined {
    if (route.errorHandler) return route.errorHandler;
    let parent = route.parent;
    while (parent) {
      if (parent.errorHandler) return parent.errorHandler;
      parent = parent.parent;
    }
  }

  protected async createElement(
    page: PageRoute,
    props: Record<string, any>,
    targetUrl?: URL,
  ): Promise<ReactNode> {
    if (page.lazy && page.component) {
      this.log.warn(
        `Page ${page.name} has both lazy and component options, lazy will be used`,
      );
    }

    if (page.lazy) {
      try {
        const component = await page.lazy();
        return createElement(component.default, props);
      } catch (error) {
        if (this.alepha.isBrowser() && this.isChunkLoadError(error)) {
          if (this.reloadAfterChunkError(targetUrl)) {
            return undefined;
          }
        }
        throw error;
      }
    }

    if (page.component) {
      return createElement(page.component, props);
    }

    return undefined;
  }

  /**
   * Detect chunk load errors caused by stale dynamic imports after a deployment.
   * When new assets are deployed with different hashes, old chunk URLs return 404.
   */
  protected isChunkLoadError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message;
    return (
      /Failed to fetch dynamically imported module/.test(msg) ||
      /error loading dynamically imported module/i.test(msg) ||
      /Unable to preload CSS/.test(msg) ||
      /Importing a module script failed/.test(msg)
    );
  }

  /**
   * Navigate to the target URL to fetch updated assets after a chunk load failure.
   * Uses sessionStorage to prevent infinite reload loops.
   * Returns true if navigation was initiated.
   */
  protected reloadAfterChunkError(url?: URL): boolean {
    const key = "alepha:chunk-reload";
    const lastReload = sessionStorage.getItem(key);
    const now = this.dateTimeProvider.nowMillis();

    if (lastReload && now - Number(lastReload) < 10_000) {
      this.log.error(
        "Chunk load failed after recent reload, not retrying to avoid loop",
      );
      return false;
    }

    this.log.warn("Chunk load failed after deployment, reloading page");
    sessionStorage.setItem(key, String(now));
    window.location.assign(
      url ? url.pathname + url.search : window.location.href,
    );
    return true;
  }

  public renderError(error: Error): ReactNode {
    return createElement(ErrorViewer, { error, alepha: this.alepha });
  }

  public renderEmptyView(): ReactNode {
    return createElement(NestedView, {});
  }

  public href(
    page: { options: { name?: string } },
    params: Record<string, any> = {},
  ): string {
    const found = this.pages.find((it) => it.name === page.options.name);
    if (!found) {
      throw new AlephaError(`Page ${page.options.name} not found`);
    }

    let url = found.path ?? "";
    let parent = found.parent;
    while (parent) {
      url = `${parent.path ?? ""}/${url}`;
      parent = parent.parent;
    }

    url = this.compile(url, params);

    return url.replace(/\/\/+/g, "/") || "/";
  }

  /**
   * Substitute `:name` tokens with param values.
   *
   * Same rules as `HttpClient.pathVariables`: the token is matched whole (so
   * `:id` cannot eat the prefix of `:idType`), a replace function keeps `$&`
   * literal instead of expanding it as a substitution pattern, and values are
   * percent-encoded — the router decodes path params, so an unencoded value
   * does not round-trip to itself.
   */
  public compile(path: string, params: Record<string, string> = {}) {
    return path.replace(/:([A-Za-z0-9_]+)/g, (match, key) =>
      Object.hasOwn(params, key)
        ? encodeURIComponent(String(params[key]))
        : match,
    );
  }

  protected renderView(
    index: number,
    path: string,
    view: ReactNode | undefined,
    page: PageRoute,
  ): ReactNode {
    view ??= this.renderEmptyView();

    return createElement(
      RouterLayerContext.Provider,
      {
        value: {
          index,
          path,
          onError:
            this.getErrorHandler(page) ?? ((error) => this.renderError(error)),
        },
      },
      view,
    );
  }

  /**
   * Resolve the effective `ssr` value for a route by walking up the parent
   * chain. Returns the nearest explicit `ssr` value, defaulting to `true`.
   *
   * The decision is made at the leaf: a parent's `ssr` only acts as a default
   * for descendants that did not set their own value.
   */
  public isSSR(route: PageRoute): boolean {
    let current: PageRoute | undefined = route;
    while (current) {
      if (typeof current.ssr === "boolean") {
        return current.ssr;
      }
      current = current.parent;
    }
    return true;
  }

  protected map(
    pages: Array<PagePrimitive>,
    target: PagePrimitive,
  ): PageRouteEntry {
    const children = target.options.children
      ? Array.isArray(target.options.children)
        ? target.options.children
        : target.options.children()
      : [];

    const getChildrenFromParent = (it: PagePrimitive): PagePrimitive[] => {
      const children = [];
      for (const page of pages) {
        if (page.options.parent === it) {
          children.push(page);
        }
      }
      return children;
    };

    children.push(...getChildrenFromParent(target));

    return {
      ...target.options,
      name: target.name,
      parent: undefined,
      children: children.map((it) => this.map(pages, it)),
    } as PageRoute;
  }

  public add(entry: PageRouteEntry) {
    if (this.alepha.isReady()) {
      throw new AlephaError("Router is already initialized");
    }

    entry.name ??= this.nextId();
    const page = entry as PageRoute;

    page.match = this.createMatch(page);
    this.pages.push(page);

    if (page.children) {
      for (const child of page.children) {
        (child as PageRoute).parent = page;
        this.add(child);
      }
    }
  }

  protected createMatch(page: PageRoute): string {
    let url = page.path ?? "/";
    let target = page.parent;
    while (target) {
      url = `${target.path ?? ""}/${url}`;
      target = target.parent;
    }

    let path = url.replace(/\/\/+/g, "/");

    if (path.endsWith("/") && path !== "/") {
      // remove trailing slash
      path = path.slice(0, -1);
    }

    return path;
  }

  protected nextId(): string {
    this.nextIdCursor += 1;
    return `P${this.nextIdCursor}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export const isPageRoute = (it: any): it is PageRoute => {
  return (
    it &&
    typeof it === "object" &&
    typeof it.path === "string" &&
    typeof it.page === "object"
  );
};

export interface PageRouteEntry
  extends Omit<PagePrimitiveOptions, "children" | "parent"> {
  children?: PageRouteEntry[];
}

export interface ConcretePageRoute extends PageRoute {
  /**
   * When exported, static routes can be split into multiple pages with different params.
   * We replace 'name' by the new name for each static entry, and old 'name' becomes 'staticName'.
   */
  staticName?: string;

  params?: Record<string, string>;
}

export interface PageRoute extends PageRouteEntry {
  type: "page";
  name: string;
  parent?: PageRoute;
  match: string;

  /**
   * Optional meta information associated with the page route, can be used for any purpose (e.g. menu label, icon, etc.).
   */
  label?: string;
}

export interface Layer {
  config?: {
    query?: Record<string, any>;
    params?: Record<string, any>;
    // stack of resolved props
    context?: Record<string, any>;
  };

  name: string;
  props?: Record<string, any>;
  error?: Error;
  part?: string;
  element: ReactNode;
  index: number;
  path: string;
  route?: PageRoute;
  cache?: boolean;
}

export type PreviousLayerData = Omit<Layer, "element" | "index" | "path">;

export interface AnchorProps {
  href: string;
  onClick: (ev?: any) => any;
}

export interface ReactRouterState {
  /**
   * Stack of layers for the current page.
   */
  layers: Array<Layer>;

  /**
   * URL of the current page.
   */
  url: URL;

  /**
   * Error handler for the current page.
   */
  onError: ErrorHandler;

  /**
   * Params extracted from the URL for the current page.
   */
  params: Record<string, any>;

  /**
   * Query parameters extracted from the URL for the current page.
   */
  query: Record<string, string>;

  /**
   * Optional meta information associated with the current page.
   */
  meta: Record<string, any>;

  /**
   * Head configuration for the current page (title, meta tags, etc.).
   * Populated by HeadProvider during SSR.
   */
  head: Head;

  /**
   * Optional name of the current page route
   */
  name?: string;
}

export interface RouterStackItem {
  route: PageRoute;
  config?: Record<string, any>;
  props?: Record<string, any>;
  error?: Error;
  cache?: boolean;
}

export interface CreateLayersResult {
  redirect?: string;
  state?: ReactRouterState;
}
