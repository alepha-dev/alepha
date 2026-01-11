import { $inject, Alepha } from "alepha";
import { ReactBrowserProvider } from "../providers/ReactBrowserProvider.ts";
import {
  type AnchorProps, type PageRoute,
  ReactPageProvider,
  type ReactRouterState,
} from "../providers/ReactPageProvider.ts";
import type { PagePrimitive, PagePrimitiveOptions } from "../primitives/$page.ts";

export interface RouterGoOptions {
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
      isActive = current.startsWith(href);
    }

    return isActive;
  }

  public node(
    name: keyof VirtualRouter<T> | string,
    config: {
      params?: Record<string, any>;
      query?: Record<string, any>;
    } = {},
  ): any { // TODO: improve typing (or just remove this method)
    const page = this.pageApi.page(name as string);
    if (!page.lazy && !page.component) {
      return {
        ...page,
        label: page.label ?? page.name,
        children: undefined,
      }
    }

    return {
      ...page,
      label: page.label ?? page.name,
      href: this.path(name, config),
      children: undefined,
    }
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
   * This is equivalent to calling `go()` with the current pathname and search.
   */
  public async reload() {
    if (!this.browser) {
      return;
    }

    await this.go(this.location.pathname + this.location.search, {
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
      throw new Error("Browser is required");
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

  public async go(path: string, options?: RouterGoOptions): Promise<void>;
  public async go(
    path: keyof VirtualRouter<T>,
    options?: RouterGoOptions,
  ): Promise<void>;
  public async go(
    path: string | keyof VirtualRouter<T>,
    options?: RouterGoOptions,
  ): Promise<void> {
    for (const page of this.pages) {
      if (page.name === path) {
        await this.browser?.go(
          this.path(path as keyof VirtualRouter<T>, options),
          options,
        );
        return;
      }
    }

    await this.browser?.go(path as string, options);
  }

  public anchor(path: string, options?: RouterGoOptions): AnchorProps;
  public anchor(
    path: keyof VirtualRouter<T>,
    options?: RouterGoOptions,
  ): AnchorProps;
  public anchor(
    path: string | keyof VirtualRouter<T>,
    options: RouterGoOptions = {},
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
        ev.stopPropagation();
        ev.preventDefault();

        this.go(href, options).catch(console.error);
      },
    };
  }

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
    const state = search ? `${this.pathname}?${search}` : this.pathname;

    if (options.push) {
      window.history.pushState({}, "", state);
    } else {
      window.history.replaceState({}, "", state);
    }
  }
}

export type VirtualRouter<T> = {
  [K in keyof T as T[K] extends PagePrimitive ? K : never]: T[K];
};
