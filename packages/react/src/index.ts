import { $module } from "@alepha/core";
import { AlephaServer, type ServerRequest } from "@alepha/server";
import { AlephaServerCache } from "@alepha/server-cache";
import { AlephaServerLinks } from "@alepha/server-links";
import type { ReactNode } from "react";
import { $page, type PageAnimation } from "./descriptors/$page.ts";
import type { ReactHydrationState } from "./providers/ReactBrowserProvider.ts";
import {
  ReactPageProvider,
  type ReactRouterState,
} from "./providers/ReactPageProvider.ts";
import { ReactServerProvider } from "./providers/ReactServerProvider.ts";
import { ReactRouter } from "./services/ReactRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactPageProvider.ts";
export * from "./providers/ReactServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
  interface State {
    "react.router.state"?: ReactRouterState;
  }

  interface Hooks {
    "react:server:render:begin": {
      request?: ServerRequest;
      state: ReactRouterState;
    };
    "react:server:render:end": {
      request?: ServerRequest;
      state: ReactRouterState;
      html: string;
    };
    // -----------------------------------------------------------------------------------------------------------------
    "react:browser:render": {
      root: HTMLElement;
      element: ReactNode;
      state: ReactRouterState;
      hydration?: ReactHydrationState;
    };
    // -----------------------------------------------------------------------------------------------------------------
    // TOP LEVEL: All user actions (forms, transitions, custom actions)
    "react:action:begin": {
      type: string;
      id?: string;
    };
    "react:action:success": {
      type: string;
      id?: string;
    };
    "react:action:error": {
      type: string;
      id?: string;
      error: Error;
    };
    "react:action:end": {
      type: string;
      id?: string;
    };
    // -----------------------------------------------------------------------------------------------------------------
    // SPECIFIC: Route transitions
    "react:transition:begin": {
      previous: ReactRouterState;
      state: ReactRouterState;
      animation?: PageAnimation;
    };
    "react:transition:success": {
      state: ReactRouterState;
    };
    "react:transition:error": {
      state: ReactRouterState;
      error: Error;
    };
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
  services: [ReactServerProvider, ReactPageProvider, ReactRouter],
  register: (alepha) =>
    alepha
      .with(AlephaServer)
      .with(AlephaServerCache)
      .with(AlephaServerLinks)
      .with(ReactServerProvider)
      .with(ReactPageProvider)
      .with(ReactRouter),
});
