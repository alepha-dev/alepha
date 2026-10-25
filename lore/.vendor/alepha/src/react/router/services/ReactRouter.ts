import { $inject, Alepha, AlephaError, type Infer, type ZType } from "alepha";

import type { PagePrimitive } from "../primitives/$page.ts";
import { ReactBrowserProvider } from "../providers/ReactBrowserProvider.ts";
import {
  type AnchorProps,
  ReactPageProvider,
  type ReactRouterState,
} from "../providers/ReactPageProvider.ts";

/**
 * What any navigation takes, to a page name or to a path.
 */
export interface RouterNavigateOptions {
  /**
   * Replace the current history entry instead of pushing a new one.
   */
  replace?: boolean;
  /**
   * The query string, as a record.
   */
  query?: Record<string, string>;
  meta?: Record<string, any>;
  /**
   * Recreate the whole page, ignoring the current state.
   */
  force?: boolean;
}

/**
 * The options of a navigation, as the browser provider receives them.
 */
export interface RouterPushOptions extends RouterNavigateOptions {
  params?: Record<string, string>;
}

/**
 * A path inside the app. Router navigation takes nothing else that is not a
 * page name: a relative path, a bare `?query` and an absolute URL are refused.
 * Changing only the query is `setQueryParams`; leaving the app is an
 * `<a href>` or `window.location.assign`.
 */
export type RouterPath = `/${string}`;

/**
 * The page names of a router class. `string` for an untyped router
 * (`useRouter()`), until the app registers its router.
 */
export type RouterPageName<T> = keyof VirtualRouter<T> & string;

/**
 * The params a page takes, read from its `schema.params`. A page that
 * declares none takes a plain string record.
 */
export type RouterPageParams<TPage> =
  TPage extends PagePrimitive<infer TConfig, any, any>
    ? TConfig["params"] extends ZType
      ? Infer<TConfig["params"]>
      : Record<string, string>
    : Record<string, string>;

/**
 * The options of a navigation to a page: `params` is required when the page's
 * params schema has a required key.
 */
export type RouterPageOptions<
  T,
  K extends RouterPageName<T>,
> = RouterNavigateOptions &
  ({} extends RouterPageParams<VirtualRouter<T>[K]>
    ? { params?: RouterPageParams<VirtualRouter<T>[K]> }
    : { params: RouterPageParams<VirtualRouter<T>[K]> });

/**
 * The options argument of a page navigation, optional only when the page
 * needs no params.
 */
export type RouterPageArgs<T, K extends RouterPageName<T>> =
  {} extends RouterPageOptions<T, K>
    ? [options?: RouterPageOptions<T, K>]
    : [options: RouterPageOptions<T, K>];

/**
 * Friendly browser router API.
 *
 * Can be safely used server-side, but most methods will be no-op.
 */
export class ReactRouter<T extends object> {
  protected readonly alepha = $inject(Alepha);
  protected readonly pageApi = $inject(ReactPageProvider);

  public get state(): ReactRouterState {
    return this.alepha.store.get("alepha.react.router.state")!;
  }

  public get pages() {
    return this.pageApi.getPages();
  }

  public get concretePages() {
    return this.pageApi.getConcretePages();
  }

  public get browser(): ReactBrowserProvider | undefined {
    if (this.alepha.isBrowser()) {
      return this.alepha.inject(ReactBrowserProvider);
    }
    // server-side
    return undefined;
  }

  /**
   * Whether `href` names the current page, or with `startWith` one of its
   * ancestors.
   *
   * Both sides are compared decoded (see {@link normalizePath}): a link built
   * from a param carries `%24` where a tree of hrefs carries `$`, and the
   * browser keeps whichever spelling the URL arrived with, so comparing the
   * raw strings left every `$primitive` page of the docs with nothing active.
   */
  public isActive(
    href: string,
    options: {
      startWith?: boolean;
    } = {},
  ): boolean {
    const current = this.normalizePath(this.state.url.pathname);
    const target = this.normalizePath(href);
    let isActive =
      current === target ||
      current === `${target}/` ||
      `${current}/` === target;

    if (options.startWith && !isActive) {
      // Match on a SEGMENT boundary. A bare `startsWith` made `/foo` active on
      // `/foobar` — and since this drives nav highlighting, a short parent
      // href lit up on every unrelated sibling that shared its prefix.
      const prefix = target.endsWith("/") ? target : `${target}/`;
      isActive = current.startsWith(prefix);
    }

    return isActive;
  }

  /**
   * A pathname in the one form `isActive` compares: each segment
   * percent-decoded, so `/a/%24b` and `/a/$b` are the same path.
   *
   * Segment by segment, and never across a boundary: a segment that is a
   * malformed escape (`%E0%A4%A`), or that decodes to something holding a
   * `/` (`%2F`), is kept verbatim. The first would throw, and the second
   * would invent a segment boundary the URL does not have, which the
   * `startWith` branch would then match on.
   */
  protected normalizePath(pathname: string): string {
    if (!pathname.includes("%")) {
      return pathname;
    }
    return pathname
      .split("/")
      .map((segment) => {
        try {
          const decoded = decodeURIComponent(segment);
          return decoded.includes("/") ? segment : decoded;
        } catch {
          return segment;
        }
      })
      .join("/");
  }

  /**
   * The pathname of a page, by name.
   *
   * A page that declares `schema.params` gets exactly the `params` given. One
   * that does not still inherits the current route's params it does not set,
   * the shorthand a child page linking to a sibling relies on.
   */
  public path(
    name: keyof VirtualRouter<T> | string,
    config: {
      params?: Record<string, any>;
      query?: Record<string, any>;
    } = {},
  ): string {
    const page = this.findPage(name as string);
    const declaresParams = !!page?.schema?.params;
    return this.pageApi.pathname(name as string, {
      params: declaresParams
        ? { ...config.params }
        : {
            ...this.state?.params,
            ...config.params,
          },
      query: config.query,
    });
  }

  /**
   * The page with this name, if any.
   */
  protected findPage(name: string) {
    return this.pages.find((page) => page.name === name);
  }

  /**
   * Refuse a page name no page has, naming the closest ones. It used to fall
   * through to a navigation to the relative URL `userProfle`.
   */
  protected unknownPage(name: string): AlephaError {
    const names = this.pages
      .map((page) => page.name)
      .filter((it): it is string => typeof it === "string");
    const closest = names
      .map((it) => ({ it, distance: this.distance(name, it) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map(({ it }) => `'${it}'`);
    return new AlephaError(
      `No page is named '${name}'. Navigate to a page name or to a path starting with "/".` +
        (closest.length ? ` Closest: ${closest.join(", ")}.` : ""),
    );
  }

  /**
   * Edit distance between two names, for {@link unknownPage}'s suggestions.
   */
  protected distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const current = row[j];
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          previous + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        previous = current;
      }
    }
    return row[b.length];
  }

  /**
   * The URL a navigation goes to: a page name resolved with its params, or a
   * path with the query appended.
   */
  protected resolveHref(
    target: string,
    options: RouterPushOptions = {},
  ): string {
    if (target.startsWith("/")) {
      if (!options.query || Object.keys(options.query).length === 0) {
        return target;
      }
      const url = new URL(target, "http://localhost");
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
      return url.pathname + url.search + url.hash;
    }
    if (!this.findPage(target)) {
      throw this.unknownPage(target);
    }
    return this.path(target as keyof VirtualRouter<T>, options);
  }

  /**
   * Reload the current page.
   * This is equivalent to calling `push()` with the current pathname and search.
   */
  public async reload() {
    if (!this.browser) {
      return;
    }

    // `browser.url` is already stripped of the base path; `location.pathname`
    // is not, and push() re-adds the base, so a non-root BASE_URL doubled it.
    await this.browser.push(this.browser.url, {
      replace: true,
      force: true,
    });
  }

  public getURL(): URL {
    if (!this.browser) {
      return this.state.url;
    }

    return new URL(this.location.href);
  }

  public get location(): Location {
    if (!this.browser) {
      throw new AlephaError("Browser is required");
    }

    return this.browser.location;
  }

  public get current(): ReactRouterState {
    return this.state;
  }

  public get pathname(): RouterPath {
    // A URL's pathname always starts with "/".
    return this.state.url.pathname as RouterPath;
  }

  public get query(): Record<string, string> {
    const query: Record<string, string> = {};

    for (const [key, value] of new URLSearchParams(
      this.state.url.search,
    ).entries()) {
      query[key] = String(value);
    }

    return query;
  }

  /**
   * Whether {@link back} has somewhere to go inside this app.
   *
   * `false` on the server and on the first entry of a session (a deep link,
   * a refresh, an arrival from another site), so a back affordance can fall
   * back to an explicit destination instead of doing nothing or leaving the
   * app. Read it in the event handler, not during render.
   */
  public get canGoBack(): boolean {
    return this.browser?.canGoBack ?? false;
  }

  public async back() {
    this.browser?.history.back();
  }

  public async forward() {
    this.browser?.history.forward();
  }

  /**
   * Re-run the current route's loaders without navigating.
   *
   * The router-level counterpart to `useQueryClient().invalidate()`: that one
   * refetches a query, this one refetches the page itself. Reach for it after
   * a mutation whose result the loaders compute, where a `push` to the same
   * URL would be a no-op.
   *
   * `props` seeds ONE value into the layer that already declares that key,
   * and everything below that layer is re-run from scratch - see
   * `ReactBrowserProvider.invalidate`, which spells out why only the first
   * key is read.
   *
   * @public No caller in this repository. It is application surface, exported
   * on the router returned by `useRouter()`; do not delete it for being
   * unreferenced.
   */
  public async invalidate(props?: Record<string, any>) {
    await this.browser?.invalidate(props);
  }

  /**
   * Navigate to a page by name, with its params, or to a path starting with
   * `/`.
   *
   * A name no page has throws an `AlephaError` naming the closest ones. A
   * path honours `query` and `replace`; `params` belongs to a page name.
   *
   * @example
   * ```ts
   * router.push("userProfile", { params: { id } });
   * router.push("/settings", { query: { tab: "security" } });
   * ```
   */
  public async push<K extends RouterPageName<T>>(
    name: K,
    ...options: RouterPageArgs<T, K>
  ): Promise<void>;
  public async push(
    path: RouterPath,
    options?: RouterNavigateOptions,
  ): Promise<void>;
  public async push(
    target: string,
    options?: RouterPushOptions,
  ): Promise<void> {
    const href = this.resolveHref(target, options);
    await this.browser?.push(href, options);
  }

  /**
   * Anchor props (`href` and an SPA `onClick`) for a page name or a path,
   * under the same two forms as {@link push}.
   */
  public anchor<K extends RouterPageName<T>>(
    name: K,
    ...options: RouterPageArgs<T, K>
  ): AnchorProps;
  public anchor(path: RouterPath, options?: RouterNavigateOptions): AnchorProps;
  public anchor(target: string, options: RouterPushOptions = {}): AnchorProps {
    const href = this.resolveHref(target, options);

    return {
      href: this.base(href),
      onClick: (ev: any) => {
        if (!this.shouldHandleAnchorClick(ev)) {
          // Modified/aux click or another browsing context — let the browser
          // do its thing ("open in new tab" must not navigate this tab).
          return;
        }

        ev.stopPropagation();
        ev.preventDefault();

        this.browser?.push(href, options).catch(console.error);
      },
    };
  }

  /**
   * True when a click on a router-managed anchor should be SPA-handled.
   *
   * Modified clicks (cmd/ctrl/shift/alt), non-primary buttons, anchors
   * targeting another browsing context, and already-prevented events fall
   * through to the browser — the single source of truth for `anchor()`,
   * `<Link>`, `useActive`, and the global interceptor.
   */
  public shouldHandleAnchorClick(ev?: {
    defaultPrevented?: boolean;
    button?: number;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    currentTarget?: unknown;
  }): boolean {
    if (!ev) {
      return true;
    }
    if (ev.defaultPrevented) {
      return false;
    }
    if (typeof ev.button === "number" && ev.button !== 0) {
      return false;
    }
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) {
      return false;
    }
    const target = (ev.currentTarget as HTMLAnchorElement | undefined)?.target;
    if (target && target !== "_self") {
      return false;
    }
    return true;
  }

  /**
   * Prepend the base URL to the given path.
   */
  public base(path: string): string {
    const base = import.meta.env?.BASE_URL;
    if (!base || base === "/") {
      return path;
    }

    return base + path;
  }

  /**
   * Set query params.
   *
   * @param record
   * @param options
   */
  public setQueryParams(
    record:
      | Record<string, any>
      | ((queryParams: Record<string, any>) => Record<string, any>),
    options: {
      /**
       * If true, this will add a new entry to the history stack.
       */
      push?: boolean;
    } = {},
  ) {
    const func = typeof record === "function" ? record : () => record;
    const search = new URLSearchParams(func(this.query)).toString();
    const path = search ? `${this.pathname}?${search}` : this.pathname;

    if (!this.browser) {
      throw new AlephaError("Browser is required");
    }

    // Through the browser provider, never `window.history` directly: it stamps
    // the `alephaKey` that popstate reads back for scroll restoration and
    // canGoBack(). A bare `replaceState({})` wiped that key.
    this.browser.pushState(path, !options.push);

    // Keep the router store in sync — `router.query`, `useQueryParams`, and
    // every `useRouterState` subscriber read from the store, not from
    // `window.location`. Writing only to history would desync them.
    const current = this.alepha.store.get("alepha.react.router.state");
    if (current) {
      const url = new URL(current.url);
      url.search = search;
      this.alepha.store.set("alepha.react.router.state", { ...current, url });
    }
  }
}

/**
 * The pages of a router class, by property name. `PagePrimitive<any, any,
 * any>`: a child page whose parent passes it props is not assignable to the
 * defaulted `PagePrimitive`, and used to be left out.
 */
export type VirtualRouter<T> = {
  [K in keyof T as T[K] extends PagePrimitive<any, any, any> ? K : never]: T[K];
};
