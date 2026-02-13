import {
  $inject,
  type Async,
  createPrimitive,
  KIND,
  type Middleware,
  Primitive,
  type Static,
  type TSchema,
} from "alepha";
import type { ClientOnlyProps } from "alepha/react";
import type { Head } from "alepha/react/head";
import type { ServerRequest } from "alepha/server";
import type { ServerRouteCache } from "alepha/server/cache";
import type { FC, ReactNode } from "react";
import { PAGE_PRELOAD_KEY } from "../constants/PAGE_PRELOAD_KEY.ts";
import type { Redirection } from "../errors/Redirection.ts";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";
import { ReactPageService } from "../services/ReactPageService.ts";

/**
 * Main primitive for defining a React route in the application.
 *
 * The $page primitive is the core building block for creating type-safe, SSR-enabled React routes.
 * It provides a declarative way to define pages with powerful features:
 *
 * **Routing & Navigation**
 * - URL pattern matching with parameters (e.g., `/users/:id`)
 * - Nested routing with parent-child relationships
 * - Type-safe URL parameter and query string validation
 *
 * **Data Loading**
 * - Server-side data fetching with the `loader` function
 * - Automatic serialization and hydration for SSR
 * - Access to request context, URL params, and parent data
 *
 * **Component Loading**
 * - Direct component rendering or lazy loading for code splitting
 * - Client-only rendering when browser APIs are needed
 * - Automatic fallback handling during hydration
 *
 * **Performance Optimization**
 * - Static generation for pre-rendered pages at build time
 * - Server-side caching with configurable TTL and providers
 * - Code splitting through lazy component loading
 *
 * **Error Handling**
 * - Custom error handlers with support for redirects
 * - Hierarchical error handling (child → parent)
 * - HTTP status code handling (404, 401, etc.)
 *
 * **Page Animations**
 * - CSS-based enter/exit animations
 * - Dynamic animations based on page state
 * - Custom timing and easing functions
 *
 * **Lifecycle Management**
 * - Server response hooks for headers and status codes
 * - Page leave handlers for cleanup (browser only)
 * - Permission-based access control
 *
 * @example Simple page with data fetching
 * ```typescript
 * const userProfile = $page({
 *   path: "/users/:id",
 *   schema: {
 *     params: t.object({ id: t.integer() }),
 *     query: t.object({ tab: t.optional(t.text()) })
 *   },
 *   loader: async ({ params }) => {
 *     const user = await userApi.getUser(params.id);
 *     return { user };
 *   },
 *   lazy: () => import("./UserProfile.tsx")
 * });
 * ```
 *
 * @example Nested routing with error handling
 * ```typescript
 * const projectSection = $page({
 *   path: "/projects/:id",
 *   children: () => [projectBoard, projectSettings],
 *   loader: async ({ params }) => {
 *     const project = await projectApi.get(params.id);
 *     return { project };
 *   },
 *   errorHandler: (error) => {
 *     if (HttpError.is(error, 404)) {
 *       return <ProjectNotFound />;
 *     }
 *   }
 * });
 * ```
 *
 * @example Static generation with caching
 * ```typescript
 * const blogPost = $page({
 *   path: "/blog/:slug",
 *   static: {
 *     entries: posts.map(p => ({ params: { slug: p.slug } }))
 *   },
 *   loader: async ({ params }) => {
 *     const post = await loadPost(params.slug);
 *     return { post };
 *   }
 * });
 * ```
 */
export const $page = <
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
>(
  options: PagePrimitiveOptions<TConfig, TProps, TPropsParent>,
): PagePrimitive<TConfig, TProps, TPropsParent> => {
  return createPrimitive(PagePrimitive<TConfig, TProps, TPropsParent>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface PagePrimitiveOptions<
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
> {
  /**
   * Identifier name for the page. Must be unique.
   *
   * @default Primitive key
   */
  name?: string;

  /**
   * Add a pathname to the page.
   *
   * Pathname can contain parameters, like `/post/:slug`.
   *
   * @default ""
   */
  path?: string;

  /**
   * Add an input schema to define:
   * - `params`: parameters from the pathname.
   * - `query`: query parameters from the URL.
   */
  schema?: TConfig;

  /**
   * Middleware to apply to the loader function.
   * Works the same as `use` on `$action` and `$job`.
   *
   * @example
   * ```ts
   * dashboard = $page({
   *   use: [$cache({ ttl: [5, "minutes"] })],
   *   loader: async ({ params }) => this.dashboardService.getData(),
   *   lazy: () => import("./Dashboard.tsx"),
   * });
   * ```
   */
  use?: Middleware[];

  /**
   * Load data before rendering the page.
   *
   * This function receives
   * - the request context (params, query, etc.)
   * - the parent props (if page has a parent)
   *
   * > In SSR, the returned data will be serialized and sent to the client, then reused during the client-side hydration.
   *
   * Loader can be stopped by throwing an error, which will be handled by the `errorHandler` function.
   * It's common to throw a `NotFoundError` to display a 404 page.
   *
   * RedirectError can be thrown to redirect the user to another page.
   */
  loader?: (context: PageLoader<TConfig, TPropsParent>) => Async<TProps>;

  /**
   * Default props to pass to the component when rendering the page.
   *
   * Resolved props from the `resolve` function will override these default props.
   */
  props?: () => Partial<TProps>;

  /**
   * The component to render when the page is loaded.
   *
   * If `lazy` is defined, this will be ignored.
   * Prefer using `lazy` to improve the initial loading time.
   */
  component?: FC<TProps & TPropsParent>;

  /**
   * Lazy load the component when the page is loaded.
   *
   * It's recommended to use this for components to improve the initial loading time
   * and enable code-splitting.
   */
  lazy?: () => Promise<{ default: FC<TProps & TPropsParent> }>;

  /**
   * Attach child pages to create nested routes.
   * This will make the page a parent route.
   */
  children?: Array<PagePrimitive> | (() => Array<PagePrimitive>);

  /**
   * Define a parent page for nested routing.
   */
  parent?: PagePrimitive<PageConfigSchema, TPropsParent, any>;

  /**
   * Function to determine if the page can be accessed.
   *
   * If it returns false, the page will not be accessible and a 403 Forbidden error will be returned.
   * This function can be used to implement permission-based access control.
   */
  can?: () => boolean;

  /**
   * Catch any error from the `loader` function or during `rendering`.
   *
   * Expected to return one of the following:
   * - a ReactNode to render an error page
   * - a Redirection to redirect the user
   * - undefined to let the error propagate
   *
   * If not defined, the error will be thrown and handled by the server or client error handler.
   * If a leaf $page does not define an error handler, the error can be caught by parent pages.
   *
   * @example Catch a 404 from API and render a custom not found component:
   * ```ts
   * loader: async ({ params, query }) => {
   *    api.fetch("/api/resource", { params, query });
   * },
   * errorHandler: (error, context) => {
   *   if (HttpError.is(error, 404)) {
   *     return <ResourceNotFound />;
   *   }
   * }
   * ```
   *
   * @example Catch an 401 error and redirect the user to the login page:
   * ```ts
   * loader: async ({ params, query }) => {
   *   // but the user is not authenticated
   *   api.fetch("/api/resource", { params, query });
   * },
   * errorHandler: (error, context) => {
   *   if (HttpError.is(error, 401)) {
   *     // throwing a Redirection is also valid!
   *     return new Redirection("/login");
   *   }
   * }
   * ```
   */
  errorHandler?: ErrorHandler;

  /**
   * If true, the page will be considered as a static page, immutable and cacheable.
   * Replace boolean by an object to define static entries. (e.g. list of params/query)
   *
   * Browser-side: it only works with `alepha/vite`, which can pre-render the page at build time.
   *
   * Server-side: It will act as timeless cached page. You can use `cache` to configure the cache behavior.
   */
  static?:
    | boolean
    | {
        entries?: Array<Partial<PageRequestConfig<TConfig>>>;
      };

  cache?: ServerRouteCache;

  /**
   * If true, force the page to be rendered only on the client-side (browser).
   * It uses the `<ClientOnly/>` component to render the page.
   */
  client?: boolean | ClientOnlyProps;

  /**
   * Called before the server response is sent to the client. (server only)
   */
  onServerResponse?: (request: ServerRequest) => unknown;

  /**
   * Called when user enters the page. (browser only)
   *
   * Useful for browser-only side effects like analytics, scroll management,
   * or focus handling that don't need to return data to the component.
   *
   * @example
   * ```ts
   * onEnter: () => {
   *   analytics.trackPageView("/dashboard");
   *   window.scrollTo(0, 0);
   * }
   * ```
   */
  onEnter?: () => void;

  /**
   * Called when user leaves the page. (browser only)
   */
  onLeave?: () => void;

  /**
   * @experimental
   *
   * Add a css animation when the page is loaded or unloaded.
   * It uses CSS animations, so you need to define the keyframes in your CSS.
   *
   * @example Simple animation name
   * ```ts
   * animation: "fadeIn"
   * ```
   *
   * CSS example:
   * ```css
   * @keyframes fadeIn {
   *  from { opacity: 0; }
   *  to { opacity: 1; }
   * }
   * ```
   *
   * @example Detailed animation
   * ```ts
   * animation: {
   *   enter: { name: "fadeIn", duration: 300 },
   *   exit: { name: "fadeOut", duration: 200, timing: "ease-in-out" },
   * }
   * ```
   *
   * @example Only exit animation
   * ```ts
   * animation: {
   *   exit: "fadeOut"
   * }
   * ```
   *
   * @example With custom timing function
   * ```ts
   * animation: {
   *   enter: { name: "fadeIn", duration: 300, timing: "cubic-bezier(0.4, 0, 0.2, 1)" },
   *   exit: { name: "fadeOut", duration: 200, timing: "ease-in-out" },
   * }
   * ```
   */
  animation?: PageAnimation;

  /**
   * Head configuration for the page (title, meta tags, etc.).
   *
   * Can be a static object or a function that receives resolved props.
   *
   * @example Static head
   * ```ts
   * head: {
   *   title: "My Page",
   *   description: "Page description",
   * }
   * ```
   *
   * @example Dynamic head based on props
   * ```ts
   * head: (props) => ({
   *   title: props.user.name,
   *   description: `Profile of ${props.user.name}`,
   * })
   * ```
   */
  head?: Head | ((props: TProps, previous?: Head) => Head);

  /**
   * Source path for SSR module preloading.
   *
   * This is automatically injected by the viteAlephaPreload plugin.
   * It maps to the source file path used in Vite's SSR manifest.
   *
   * @internal
   */
  [PAGE_PRELOAD_KEY]?: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export class PagePrimitive<
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
> extends Primitive<PagePrimitiveOptions<TConfig, TProps, TPropsParent>> {
  protected readonly reactPageService = $inject(ReactPageService);

  protected onInit() {
    if (this.options.static) {
      this.options.cache ??= {
        store: {
          provider: "memory",
          ttl: [1, "week"],
        },
      };
    }
  }

  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  /**
   * For testing or build purposes.
   *
   * This will render the page (HTML layout included or not) and return the HTML + context.
   * Only valid for server-side rendering, it will throw an error if called on the client-side.
   */
  public async render(
    options?: PagePrimitiveRenderOptions,
  ): Promise<PagePrimitiveRenderResult> {
    return this.reactPageService.render(this.name, options);
  }

  public async fetch(options?: PagePrimitiveRenderOptions): Promise<{
    html: string;
    response: Response;
  }> {
    return this.reactPageService.fetch(this.options.path || "", options);
  }
}

$page[KIND] = PagePrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export type ErrorHandler = (
  error: Error,
  state: ReactRouterState,
) => ReactNode | Redirection | undefined;

export interface PageConfigSchema {
  query?: TSchema;
  params?: TSchema;
}

export type TPropsDefault = any;

export type TPropsParentDefault = {};

export interface PagePrimitiveRenderOptions {
  params?: Record<string, string>;
  query?: Record<string, string>;

  /**
   * If true, the HTML layout will be included in the response.
   * If false, only the page content will be returned.
   *
   * @default true
   */
  html?: boolean;
  hydration?: boolean;
}

export interface PagePrimitiveRenderResult {
  html: string;
  state: ReactRouterState;
  redirect?: string;
}

export interface PageRequestConfig<
  TConfig extends PageConfigSchema = PageConfigSchema,
> {
  params: TConfig["params"] extends TSchema
    ? Static<TConfig["params"]>
    : Record<string, string>;

  query: TConfig["query"] extends TSchema
    ? Static<TConfig["query"]>
    : Record<string, string>;
}

export type PageLoader<
  TConfig extends PageConfigSchema = PageConfigSchema,
  TPropsParent extends object = TPropsParentDefault,
> = PageRequestConfig<TConfig> &
  TPropsParent &
  Omit<ReactRouterState, "layers" | "onError">;

export type PageAnimation =
  | PageAnimationObject
  | ((state: ReactRouterState) => PageAnimationObject | undefined);

type PageAnimationObject =
  | CssAnimationName
  | {
      enter?: CssAnimation | CssAnimationName;
      exit?: CssAnimation | CssAnimationName;
    };

type CssAnimationName = string;

type CssAnimation = {
  name: string;
  duration?: number;
  timing?: string;
};
