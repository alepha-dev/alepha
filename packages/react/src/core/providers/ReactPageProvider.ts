import {
  $env,
  $hook,
  $inject,
  Alepha,
  AlephaError,
  type Static,
  type TSchema,
  t,
} from "alepha";
import { $logger } from "alepha/logger";
import { createElement, type ReactNode, StrictMode } from "react";
import ClientOnly from "../components/ClientOnly.tsx";
import ErrorViewer from "../components/ErrorViewer.tsx";
import NestedView from "../components/NestedView.tsx";
import NotFoundPage from "../components/NotFound.tsx";
import { AlephaContext } from "../contexts/AlephaContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import {
  $page,
  type ErrorHandler,
  type PagePrimitive,
  type PagePrimitiveOptions,
} from "../primitives/$page.ts";
import { Redirection } from "../errors/Redirection.ts";

const envSchema = t.object({
  REACT_STRICT_MODE: t.boolean({ default: true }),
});

declare module "alepha" {
  export interface Env extends Partial<Static<typeof envSchema>> {}
}

export class ReactPageProvider {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly pages: PageRoute[] = [];

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

  public pathname(
    name: string,
    options: {
      params?: Record<string, string>;
      query?: Record<string, string>;
    } = {},
  ) {
    const page = this.page(name);
    if (!page) {
      throw new Error(`Page ${name} not found`);
    }

    let url = page.path ?? "";
    let parent = page.parent;
    while (parent) {
      url = `${parent.path ?? ""}/${url}`;
      parent = parent.parent;
    }

    url = this.compile(url, options.params ?? {});

    if (options.query) {
      const query = new URLSearchParams(options.query);
      if (query.toString()) {
        url += `?${query.toString()}`;
      }
    }

    return url.replace(/\/\/+/g, "/") || "/";
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
    );

    if (this.env.REACT_STRICT_MODE) {
      return createElement(StrictMode, {}, root);
    }

    return root;
  }

  protected convertStringObjectToObject = (
    schema?: TSchema,
    value?: any,
  ): any => {
    if (t.schema.isObject(schema) && typeof value === "object") {
      for (const key in schema.properties) {
        if (
          t.schema.isObject(schema.properties[key]) &&
          typeof value[key] === "string"
        ) {
          try {
            value[key] = this.alepha.codec.decode(
              schema.properties[key],
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
          ? this.alepha.codec.decode(route.schema.query, state.query)
          : {};
      } catch (e) {
        it.error = e as Error;
        break;
      }

      try {
        config.params = route.schema?.params
          ? this.alepha.codec.decode(route.schema.params, state.params)
          : {};
      } catch (e) {
        it.error = e as Error;
        break;
      }

      // save config
      it.config = {
        ...config,
      };

      // check if previous layer is the same, reuse if possible
      if (previous?.[i] && !forceRefresh && previous[i].name === route.name) {
        const url = (str?: string) => (str ? str.replace(/\/\/+/g, "/") : "/");

        const prev = JSON.stringify({
          part: url(previous[i].part),
          params: previous[i].config?.params ?? {},
        });

        const curr = JSON.stringify({
          part: url(route.path),
          params: config.params ?? {},
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

      // no resolve, render a basic view by default
      if (!route.resolve) {
        continue;
      }

      try {
        const args = Object.create(state);
        Object.assign(args, config, context);
        const props = (await route.resolve?.(args)) ?? {};

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

        this.log.error("Page resolver has failed", e);

        it.error = e as Error;
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
          const element = await this.createElement(it.route, {
            // default props attached to page
            ...it.route.props,
            // resolved props
            ...props,
            // context props (from previous layers)
            ...context,
          });

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
          it.error = e as Error;
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
  ): Promise<ReactNode> {
    if (page.lazy && page.component) {
      this.log.warn(
        `Page ${page.name} has both lazy and component options, lazy will be used`,
      );
    }

    if (page.lazy) {
      const component = await page.lazy(); // load component
      return createElement(component.default, props);
    }

    if (page.component) {
      return createElement(page.component, props);
    }

    return undefined;
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

  public compile(path: string, params: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, value);
    }
    return path;
  }

  protected renderView(
    index: number,
    path: string,
    view: ReactNode | undefined,
    page: PageRoute,
  ): ReactNode {
    view ??= this.renderEmptyView();

    const element = page.client
      ? createElement(
          ClientOnly,
          typeof page.client === "object" ? page.client : {},
          view,
        )
      : view;

    return createElement(
      RouterLayerContext.Provider,
      {
        value: {
          index,
          path,
          onError: this.getErrorHandler(page) ?? ((error) => this.renderError(error)),
        },
      },
      element,
    );
  }

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
          cache: true,
          component: NotFoundPage,
          onServerResponse: ({ reply }) => {
            reply.status = 404;
          },
        });
      }
    },
  });

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

  protected _next = 0;

  protected nextId(): string {
    this._next += 1;
    return `P${this._next}`;
  }
}

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

  //
  name?: string;
}

export interface RouterStackItem {
  route: PageRoute;
  config?: Record<string, any>;
  props?: Record<string, any>;
  error?: Error;
  cache?: boolean;
}

export interface TransitionOptions {
  previous?: PreviousLayerData[];
}

export interface CreateLayersResult {
  redirect?: string;
  state?: ReactRouterState;
}
