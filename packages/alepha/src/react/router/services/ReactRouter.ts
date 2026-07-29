import { $inject, Alepha, AlephaError } from "alepha";
import type { PagePrimitive } from "../primitives/$page.ts";
import { ReactBrowserProvider } from "../providers/ReactBrowserProvider.ts";
import {
  type AnchorProps,
  ReactPageProvider,
  type ReactRouterState,
} from "../providers/ReactPageProvider.ts";

export interface RouterPushOptions {
  replace?: boolean;
  params?: Record<string, string>;
  query?: Record<string, string>;
  meta?: Record<string, any>;
  /**
   * Recreate the whole page, ignoring the current state.
   */
  force?: boolean;
}

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

  public isActive(
    href: string,
    options: {
      startWith?: boolean;
    } = {},
  ): boolean {
    const current = this.state.url.pathname;
    let isActive =
      current === href || current === `${href}/` || `${current}/` === href;

    if (options.startWith && !isActive) {
      // Match on a SEGMENT boundary. A bare `startsWith` made `/foo` active on
      // `/foobar` — and since this drives nav highlighting, a short parent
      // href lit up on every unrelated sibling that shared its prefix.
      const prefix = href.endsWith("/") ? href : `${href}/`;
      isActive = current.startsWith(prefix);
    }

    return isActive;
  }

  public node(
    name: keyof VirtualRouter<T> | string,
    config: {
      params?: Record<string, any>;
      query?: Record<string, any>;
    } = {},
  ): any {
    // TODO: improve typing (or just remove this method)
    const page = this.pageApi.page(name as string);
    if (!page.lazy && !page.component) {
      return {
        ...page,
        label: page.label ?? page.name,
        children: undefined,
      };
    }

    return {
      ...page,
      label: page.label ?? page.name,
      href: this.path(name, config),
      children: undefined,
    };
  }

  public path(
    name: keyof VirtualRouter<T> | string,
    config: {
      params?: Record<string, any>;
      query?: Record<string, any>;
    } = {},
  ): string {
    return this.pageApi.pathname(name as string, {
      params: {
        ...this.state?.params,
        ...config.params,
      },
      query: config.query,
    });
  }

  /**
   * Reload the current page.
   * This is equivalent to calling `push()` with the current pathname and search.
   */
  public async reload() {
    if (!this.browser) {
      return;
    }

    await this.push(this.location.pathname + this.location.search, {
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

  public get pathname(): string {
    return this.state.url.pathname;
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

  public async back() {
    this.browser?.history.back();
  }

  public async forward() {
    this.browser?.history.forward();
  }

  public async invalidate(props?: Record<string, any>) {
    await this.browser?.invalidate(props);
  }

  public async push(path: string, options?: RouterPushOptions): Promise<void>;
  public async push(
    path: keyof VirtualRouter<T>,
    options?: RouterPushOptions,
  ): Promise<void>;
  public async push(
    path: string | keyof VirtualRouter<T>,
    options?: RouterPushOptions,
  ): Promise<void> {
    for (const page of this.pages) {
      if (page.name === path) {
        await this.browser?.push(
          this.path(path as keyof VirtualRouter<T>, options),
          options,
        );
        return;
      }
    }

    await this.browser?.push(path as string, options);
  }

  public anchor(path: string, options?: RouterPushOptions): AnchorProps;
  public anchor(
    path: keyof VirtualRouter<T>,
    options?: RouterPushOptions,
  ): AnchorProps;
  public anchor(
    path: string | keyof VirtualRouter<T>,
    options: RouterPushOptions = {},
  ): AnchorProps {
    let href = path as string;

    for (const page of this.pages) {
      if (page.name === path) {
        href = this.path(path as keyof VirtualRouter<T>, options);
        break;
      }
    }

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

        this.push(href, options).catch(console.error);
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
    const state = this.base(path);

    if (options.push) {
      window.history.pushState({}, "", state);
    } else {
      window.history.replaceState({}, "", state);
    }

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

export type VirtualRouter<T> = {
  [K in keyof T as T[K] extends PagePrimitive ? K : never]: T[K];
};
