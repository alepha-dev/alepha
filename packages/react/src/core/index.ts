import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaServer, type ServerRequest } from "alepha/server";
import { AlephaServerCache } from "alepha/server/cache";
import { AlephaServerLinks } from "alepha/server/links";
import type { ReactNode } from "react";
import { $page, type PageAnimation } from "./descriptors/$page.ts";
import type { ReactHydrationState } from "./providers/ReactBrowserProvider.ts";
import {
  ReactPageProvider,
  type ReactRouterState,
} from "./providers/ReactPageProvider.ts";
import { ReactServerProvider } from "./providers/ReactServerProvider.ts";
import { ReactPageServerService } from "./services/ReactPageServerService.ts";
import { ReactPageService } from "./services/ReactPageService.ts";
import { ReactRouter } from "./services/ReactRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactPageProvider.ts";
export * from "./providers/ReactServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface State {
    "alepha.react.router.state"?: ReactRouterState;
  }

  interface Hooks {
    /**
     * Fires when the React application is starting to be rendered on the server.
     */
    "react:server:render:begin": {
      request?: ServerRequest;
      state: ReactRouterState;
    };
    /**
     * Fires when the React application has been rendered on the server.
     */
    "react:server:render:end": {
      request?: ServerRequest;
      state: ReactRouterState;
      html: string;
    };
    // -----------------------------------------------------------------------------------------------------------------
    /**
     * Fires when the React application is being rendered on the browser.
     */
    "react:browser:render": {
      root: HTMLElement;
      element: ReactNode;
      state: ReactRouterState;
      hydration?: ReactHydrationState;
    };
    // -----------------------------------------------------------------------------------------------------------------
    // TOP LEVEL: All user actions (forms, transitions, custom actions)
    /**
     * Fires when a user action is starting.
     * Action can be a form submission, a route transition, or a custom action.
     */
    "react:action:begin": {
      type: string;
      id?: string;
    };
    /**
     * Fires when a user action has succeeded.
     * Action can be a form submission, a route transition, or a custom action.
     */
    "react:action:success": {
      type: string;
      id?: string;
    };
    /**
     * Fires when a user action has failed.
     * Action can be a form submission, a route transition, or a custom action.
     */
    "react:action:error": {
      type: string;
      id?: string;
      error: Error;
    };
    /**
     * Fires when a user action has completed, regardless of success or failure.
     * Action can be a form submission, a route transition, or a custom action.
     */
    "react:action:end": {
      type: string;
      id?: string;
    };
    // -----------------------------------------------------------------------------------------------------------------
    // SPECIFIC: Route transitions
    /**
     * Fires when a route transition is starting.
     */
    "react:transition:begin": {
      previous: ReactRouterState;
      state: ReactRouterState;
      animation?: PageAnimation;
    };
    /**
     * Fires when a route transition has succeeded.
     */
    "react:transition:success": {
      state: ReactRouterState;
    };
    /**
     * Fires when a route transition has failed.
     */
    "react:transition:error": {
      state: ReactRouterState;
      error: Error;
    };
    /**
     * Fires when a route transition has completed, regardless of success or failure.
     */
    "react:transition:end": {
      state: ReactRouterState;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides full-stack React development with declarative routing, server-side rendering, and client-side hydration.
 *
 * The React module enables building modern React applications using the `$page` descriptor on class properties.
 * It delivers seamless server-side rendering, automatic code splitting, and client-side navigation with full
 * type safety and schema validation for route parameters and data.
 *
 * @see {@link $page}
 * @module alepha.react
 */
export const AlephaReact = $module({
  name: "alepha.react",
  descriptors: [$page],
  services: [
    ReactServerProvider,
    ReactPageProvider,
    ReactRouter,
    ReactPageService,
    ReactPageServerService,
  ],
  register: (alepha) =>
    alepha
      .with(AlephaDateTime)
      .with(AlephaServer)
      .with(AlephaServerCache)
      .with(AlephaServerLinks)
      .with({
        provide: ReactPageService,
        use: ReactPageServerService,
      })
      .with(ReactServerProvider)
      .with(ReactPageProvider)
      .with(ReactRouter),
});
