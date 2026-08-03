import {
  $inject,
  type Async,
  createPrimitive,
  type Infer,
  KIND,
  type Middleware,
  OPTIONS,
  Primitive,
  type ZType,
} from "alepha";
import { $cache } from "alepha/cache";
import type { Head } from "alepha/react/head";
import type { ServerRequest } from "alepha/server";
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
 * - Infer generation for pre-rendered pages at build time
 * - Server-side caching via the `$cache` middleware in `use: [...]`
 * - Code splitting through lazy component loading
 *
 * **Error Handling**
 * - Custom error handlers with support for redirects
 * - Hierarchical error handling (child → parent)
 * - HTTP status code handling (404, 401, etc.)
 *
 * @example Simple page with data fetching
 * ```typescript
 * const userProfile = $page({
 *   path: "/users/:id",
 *   schema: {
 *     params: z.object({ id: z.integer() }),
 *     query: z.object({ tab: z.text().optional() })
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
 * @example Infer generation with caching
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
   * Props returned by the `loader` will override these default props.
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
   * Attach child pages to create nested routes, adopting them as children of
   * this page.
   *
   * Use this when you want a parent to own children it cannot modify — most
   * notably pages that come from an injected router in another package, whose
   * `$page` definitions are frozen and cannot declare `parent` themselves.
   *
   * ```ts
   * layout = $page({
   *   path: "/app",
   *   children: () => [
   *     this.productRouter.catalogPage,  // from $inject(ProductRouter)
   *     this.productRouter.checkoutPage,
   *   ],
   * });
   * ```
   *
   * Use a thunk (`() => [...]`) when the children are defined later in the
   * same class.
   *
   * **Declare each edge from one side only.** If a child already sets
   * `parent: thisPage`, do NOT also add it to `children` — the link is
   * already established, and declaring it on both sides creates a TypeScript
   * circular dependency between the two class fields (each references the
   * other before it is initialised).
   */
  children?: Array<PagePrimitive> | (() => Array<PagePrimitive>);

  /**
   * Define a parent page for nested routing.
   *
   * Use this when you own the child page and can edit its definition — it is
   * the simplest way to nest routes and reads top-down. For pages you do NOT
   * own (e.g. pages exposed by an injected router from another package), let
   * the parent adopt them via its `children` option instead.
   *
   * **Declare each edge from one side only.** If you set `parent` here, do
   * NOT also add this page to the parent's `children` array — the link is
   * already established, and declaring it on both sides creates a TypeScript
   * circular dependency between the two class fields.
   */
  parent?: PagePrimitive<PageConfigSchema, TPropsParent, any>;

  /**
   * UI-affordance predicate for this page's navigation entry — **NOT security**.
   * For real access control, gate the route with `use: [$secure({ permissions })]`
   * (server-enforced); `can` is only consulted by navigation surfaces (sidebar,
   * breadcrumbs, command palette), never by the router.
   *
   * Receives a `{ has }` context (a permission probe equivalent to
   * `useAuth().has`) so it can express arbitrary access logic — including
   * OR-of-permissions, which `nav.permission` (AND) cannot.
   *
   * - `true` (or omitted) → nav entry visible and enabled.
   * - `"disabled"` → visible but disabled (greyed — e.g. insufficient role / paywalled).
   * - `false` → hidden.
   *
   * For the common "needs these permissions" case, prefer the declarative
   * {@link PageNav.permission} instead.
   */
  can?: (ctx: PageCanContext) => boolean | "disabled";

  /**
   * Navigation metadata — declares this page's presence in navigation
   * surfaces: the sidebar, the breadcrumb trail, and a command palette
   * (Spotlight). A page WITHOUT `nav` is route-only (reachable by URL but not
   * listed).
   *
   * `$page` is pure React, so `label` / `icon` / `description` / `badge` accept
   * `ReactNode` (pass `<Users />` directly).
   *
   * Visibility is UI-only (NOT security — gate the route with `use: [$secure(...)]`):
   * an entry is hidden when `nav.hidden`, when `nav.permission` is set and not
   * fully granted, or when `can()` returns `false`; it renders disabled when
   * `can()` returns `"disabled"`.
   */
  nav?: PageNav;

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
   * Browser-side: it only works with the build pipeline, which can pre-render the page at build time.
   *
   * Server-side: the page is cached automatically — `static: true` pushes a
   * `$cache({ provider: "memory", ttl: [1, "week"] })` middleware into `use`.
   * Attach your own `$cache` in `use: [...]` to customize the behavior.
   */
  static?:
    | boolean
    | {
        entries?: Array<Partial<PageRequestConfig<TConfig>>>;
      };

  /**
   * Enable or disable server-side rendering for this page.
   *
   * - `true` (default): the page component is rendered on the server and
   *   hydrated on the client.
   * - `false`: the loader still runs on the server (so data is preloaded and
   *   serialized for hydration), but the component is rendered only on the
   *   client. The server emits no HTML for this page.
   *
   * **Decided at the leaf, inherited as default by descendants.**
   *
   * The effective value is determined by the matched leaf page: walk up the
   * parent chain and use the nearest explicit `ssr` value. Setting
   * `ssr: false` on a parent therefore acts as the default for its children;
   * a child can override with `ssr: true`.
   *
   * Skipping rendering while keeping the loader is the recommended strategy
   * for CPU-constrained server environments (e.g. Cloudflare Workers) and
   * heavy admin/dashboard views where SSR provides little SEO value.
   *
   * @example
   * ```ts
   * root  = $page({ ssr: false });               // default for children
   * home  = $page({ parent: root, ssr: true });  // overrides → SSR
   * about = $page({ parent: root });             // inherits  → no SSR
   * ```
   *
   * @default true
   */
  ssr?: boolean;

  /**
   * Buffer the HTML instead of streaming it, so the page can choose its status
   * code. (server only)
   *
   * By default a page is streamed with an early `<head>` flush: the head leaves
   * before the loader has run, which is what makes the first paint fast. The cost
   * is that the HTTP status is already committed by then — `onServerResponse` runs
   * before the loader, so it cannot know what the loader found, and a page whose
   * existence depends on data has no way to answer 404. A missing product
   * rendered the error boundary with a 200, which a crawler indexes as a real
   * page.
   *
   * With `stream: false` the page renders to a string first and only then
   * replies, so `onServerResponse` sees the finished render and can set
   * `reply.status`. This is the same path a cached page already takes.
   *
   * Use it for the handful of routes that can legitimately not exist — a product,
   * an article, a profile. Leave it alone everywhere else: buffering delays the
   * first byte by the whole render.
   *
   * ```ts
   * product = $page({
   *   path: "/product/:slug",
   *   stream: false,
   *   loader: async ({ params }) => {
   *     const product = await api.find(params.slug);
   *     if (!product) throw new NotFoundError("No such product");
   *     return { product };
   *   },
   *   onServerResponse: ({ reply }) => { ... },
   * });
   * ```
   *
   * @default true
   */
  stream?: boolean;

  /**
   * Called before the server response is sent to the client. (server only)
   *
   * Runs *before* the loader on a streamed page, and *after* the render on one
   * with `stream: false` — which is the only way it can react to what the loader
   * found. See {@link stream}.
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
   * @example Infer head
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
   * Redirect to another path when this page is matched.
   *
   * This is a shorthand for throwing a `Redirection` in the loader.
   * The redirect is performed before any loader or component rendering.
   *
   * @example
   * ```ts
   * home = $page({
   *   path: "/",
   *   redirect: "/dashboard",
   * });
   * ```
   */
  redirect?: string;

  /**
   * Label for the page, used for navigation menus or breadcrumbs.
   *
   * This is optional and can be used by the application to display a user-friendly name for the page.
   * It has no functional impact on routing or rendering.
   */
  label?: string;

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
      this.options.use ??= [];
      if (!this.options.use.some((m) => m[OPTIONS]?.name === "$cache")) {
        this.options.use.push(
          $cache({
            name: `page:${this.name}`,
            provider: "memory",
            ttl: [1, "week"],
          }),
        );
      }
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

/**
 * Context passed to {@link PagePrimitiveOptions.can} — a permission probe
 * (equivalent to `useAuth().has`) supplied by the navigation builder.
 */
export interface PageCanContext {
  has: (permission: string) => boolean;
}

/**
 * Navigation metadata for a page — see {@link PagePrimitiveOptions.nav}.
 * Consumed by the sidebar, breadcrumbs and the command palette, all derived
 * from the route tree (no separate nav list).
 */
export interface PageNav {
  /**
   * Label for nav surfaces. Falls back to the page's `label`, then `head.title`.
   */
  label?: ReactNode;
  /**
   * Leading icon — a React element, e.g. `icon: <Users />`.
   */
  icon?: ReactNode;
  /**
   * Section the entry belongs to: sidebar group heading + command-palette section.
   */
  group?: string;
  /**
   * Sort order within the group (ascending).
   */
  order?: number;
  /**
   * Permission(s) required to SEE the entry — a single string or an array
   * (ALL required, matching `$secure({ permissions })`). UI gate only; the
   * real route gate is `use: [$secure(...)]`. For OR / custom logic use `can`.
   */
  permission?: string | string[];
  /**
   * Extra search terms for the command palette (synonyms / aliases beyond the label).
   */
  keywords?: string[];
  /**
   * Short description — command-palette subtitle / sidebar tooltip.
   */
  description?: ReactNode;
  /**
   * Trailing badge (unread count, "New", …) for the sidebar entry.
   */
  badge?: ReactNode;
  /**
   * Keep the route but exclude it from nav surfaces (e.g. a `/users/:id` detail page).
   */
  hidden?: boolean;
}

export type ErrorHandler = (
  error: Error,
  state: ReactRouterState,
) => ReactNode | Redirection | undefined;

export interface PageConfigSchema {
  query?: ZType;
  params?: ZType;
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
  params: TConfig["params"] extends ZType
    ? Infer<TConfig["params"]>
    : Record<string, string>;

  query: TConfig["query"] extends ZType
    ? Infer<TConfig["query"]>
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
