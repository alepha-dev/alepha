import {
  $atom,
  $hook,
  $inject,
  $state,
  Alepha,
  type State,
  type Static,
  t,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { BrowserHeadProvider } from "alepha/react/head";
import { LinkProvider } from "alepha/server/links";
import type { RouterPushOptions } from "../services/ReactRouter.ts";
import { ReactBrowserRouterProvider } from "./ReactBrowserRouterProvider.ts";
import type {
  PreviousLayerData,
  ReactRouterState,
} from "./ReactPageProvider.ts";

export type { RouterPushOptions } from "../services/ReactRouter.ts";

/**
 * React browser renderer configuration atom
 */
export const reactBrowserOptions = $atom({
  name: "alepha.react.browser.options",
  schema: t.object({
    scrollRestoration: t.enum(["top", "manual"]), // TODO: must be per page?
  }),
  default: {
    scrollRestoration: "top" as const,
  },
});

export type ReactBrowserRendererOptions = Static<
  typeof reactBrowserOptions.schema
>;

declare module "alepha" {
  interface State {
    [reactBrowserOptions.key]: ReactBrowserRendererOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class ReactBrowserProvider {
  protected readonly log = $logger();
  protected readonly client = $inject(LinkProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly router = $inject(ReactBrowserRouterProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly browserHeadProvider = $inject(BrowserHeadProvider);

  protected readonly options = $state(reactBrowserOptions);

  public get rootId() {
    return "root";
  }

  protected getRootElement() {
    const root = this.document.getElementById(this.rootId);
    if (root) {
      return root;
    }

    const div = this.document.createElement("div");
    div.id = this.rootId;

    this.document.body.prepend(div);

    return div;
  }

  public transitioning?: {
    to: string;
    from?: string;
  };

  public get state(): ReactRouterState {
    return this.alepha.store.get("alepha.react.router.state")!;
  }

  /**
   * Accessor for Document DOM API.
   */
  public get document() {
    return window.document;
  }

  /**
   * Accessor for History DOM API.
   */
  public get history() {
    return window.history;
  }

  /**
   * Accessor for Location DOM API.
   */
  public get location() {
    return window.location;
  }

  public get base() {
    const base = import.meta.env?.BASE_URL;
    if (!base || base === "/") {
      return "";
    }

    return base;
  }

  public get url(): string {
    const url = this.location.pathname + this.location.search;
    if (this.base) {
      return url.replace(this.base, "");
    }
    return url;
  }

  public pushState(path: string, replace?: boolean) {
    const url = this.base + path;

    if (replace) {
      this.history.replaceState({}, "", url);
    } else {
      this.history.pushState({}, "", url);
    }
  }

  public async invalidate(props?: Record<string, any>) {
    const previous: PreviousLayerData[] = [];

    this.log.trace("Invalidating layers");

    if (props) {
      const [key] = Object.keys(props);
      const value = props[key];

      for (const layer of this.state.layers) {
        if (layer.props?.[key]) {
          previous.push({
            ...layer,
            props: {
              ...layer.props,
              [key]: value,
            },
          });
          break;
        }
        previous.push(layer);
      }
    }

    await this.render({ previous });
  }

  public async push(
    url: string,
    options: RouterPushOptions = {},
  ): Promise<void> {
    this.log.trace(`Going to ${url}`, {
      url,
      options,
    });

    await this.render({
      url,
      previous: options.force ? [] : this.state.layers,
      meta: options.meta,
    });

    // when redirecting in browser
    if (this.state.url.pathname + this.state.url.search !== url) {
      this.pushState(this.state.url.pathname + this.state.url.search);
      return;
    }

    this.pushState(url, options.replace);
  }

  protected async render(options: RouterRenderOptions = {}): Promise<void> {
    const previous = options.previous ?? this.state.layers;
    const url = options.url ?? this.url;
    const start = this.dateTimeProvider.now();

    this.transitioning = {
      to: url,
      from: this.state?.url.pathname,
    };

    this.log.debug("Transitioning...", {
      to: url,
    });

    const redirect = await this.router.transition(
      new URL(`http://localhost${url}`),
      previous,
      options.meta,
    );

    if (redirect) {
      this.log.info("Redirecting to", {
        redirect,
      });

      // if redirect is an absolute URL, use window.location.href (full page reload)
      if (redirect.startsWith("http")) {
        window.location.href = redirect;
      } else {
        // if redirect is a relative URL, use render() (single page app)
        return await this.render({ url: redirect });
      }
    }

    const ms = this.dateTimeProvider.now().diff(start);
    this.log.info(`Transition OK [${ms}ms]`, this.transitioning);

    this.transitioning = undefined;
  }

  /**
   * Get embedded layers from the server.
   */
  protected getHydrationState(): ReactHydrationState | undefined {
    try {
      const el = this.document.getElementById("__ssr");
      if (el?.textContent) {
        return JSON.parse(el.textContent) as ReactHydrationState;
      }
    } catch (error) {
      console.error(error);
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected readonly onTransitionEnd = $hook({
    on: "react:transition:end",
    handler: () => {
      if (
        this.options.scrollRestoration === "top" &&
        typeof window !== "undefined" &&
        !this.alepha.isTest()
      ) {
        this.log.trace("Restoring scroll position to top");
        window.scrollTo(0, 0);
      }
    },
  });

  public readonly ready = $hook({
    on: "ready",
    handler: async () => {
      const hydration = this.getHydrationState();
      const previous = hydration?.["alepha.react.router.layers"] ?? [];

      if (hydration) {
        // low budget, but works for now
        for (const [key, value] of Object.entries(hydration)) {
          if (key !== "alepha.react.router.layers") {
            this.alepha.set(key as keyof State, value);
          }
        }
      }

      await this.render({ previous });

      const element = this.router.root(this.state);

      await this.alepha.events.emit("react:browser:render", {
        element,
        root: this.getRootElement(),
        hydration,
        state: this.state,
      });

      window.addEventListener("popstate", () => {
        // when you update silently queryParams or hash, skip rendering
        // if you want to force a rendering, use #go()
        if (this.base + this.state.url.pathname === this.location.pathname) {
          return;
        }

        this.log.debug("Popstate event triggered - rendering new state", {
          url: this.location.pathname + this.location.search,
        });

        this.render();
      });
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------

export type ReactHydrationState = {
  "alepha.react.router.layers"?: Array<PreviousLayerData>;
} & {
  [key: string]: any;
};

export interface RouterRenderOptions {
  url?: string;
  previous?: PreviousLayerData[];
  meta?: Record<string, any>;
}
