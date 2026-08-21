import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaReact } from "alepha/react";
import { AlephaReactHead } from "alepha/react/head";
import { AlephaServer, type ServerRequest } from "alepha/server";
import { AlephaServerEtag } from "alepha/server/etag";
import { AlephaServerLinks } from "alepha/server/links";
import type { ReactNode } from "react";

import { $page, type PageAnimation } from "./primitives/$page.ts";
import type { ReactHydrationState } from "./providers/ReactBrowserProvider.ts";
import { ReactDomServerProvider } from "./providers/ReactDomServerProvider.ts";
import {
  ReactPageProvider,
  type ReactRouterState,
} from "./providers/ReactPageProvider.ts";
import { ReactPreloadProvider } from "./providers/ReactPreloadProvider.ts";
import { ReactServerErrorProvider } from "./providers/ReactServerErrorProvider.ts";
import { ReactServerProvider } from "./providers/ReactServerProvider.ts";
import { ReactServerTemplateProvider } from "./providers/ReactServerTemplateProvider.ts";
import { RouterLocaleProvider } from "./providers/RouterLocaleProvider.ts";
import { SSRManifestProvider } from "./providers/SSRManifestProvider.ts";
import { ReactPageServerService } from "./services/ReactPageServerService.ts";
import { ReactPageService } from "./services/ReactPageService.ts";
import { ReactRouter } from "./services/ReactRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./constants/PAGE_ROUTE.ts";
export * from "./index.shared.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactDomServerProvider.ts";
export * from "./providers/ReactPageProvider.ts";
export * from "./providers/ReactPreloadProvider.ts";
export * from "./providers/ReactServerErrorProvider.ts";
export * from "./providers/ReactServerProvider.ts";
export * from "./providers/ReactServerTemplateProvider.ts";
export * from "./providers/RouterLocaleProvider.ts";
export * from "./providers/SSRManifestProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface State {
    "alepha.react.router.state"?: ReactRouterState;
    /**
     * The active locale path-prefix (e.g. `"fr"`), when `routing: "prefix"` is
     * enabled on the i18n module. Empty/absent for the default locale.
     */
    "alepha.react.router.locale"?: string;
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
     *
     * Note: this one is not really necessary, it's a hack because we need to isolate renderer from server code in order
     * to avoid including react-dom/client in server bundles.
     */
    "react:browser:render": {
      root: HTMLElement;
      element: ReactNode;
      state: ReactRouterState;
      hydration?: ReactHydrationState;
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
 * Provides declarative routing with the `$page` primitive for building type-safe React routes.
 *
 * This module enables:
 * - URL pattern matching with parameters (e.g., `/users/:id`)
 * - Nested routing with parent-child relationships
 * - Type-safe URL parameter and query string validation
 * - Server-side data fetching with the `loader` function
 * - Lazy loading and code splitting
 * - Page animations and error handling
 *
 * @see {@link $page}
 * @module alepha.react.router
 */
export const AlephaReactRouter = $module({
  name: "alepha.react.router",
  primitives: [$page],
  services: [
    ReactDomServerProvider,
    ReactPageProvider,
    ReactPageService,
    ReactPreloadProvider,
    ReactRouter,
    ReactServerErrorProvider,
    ReactServerProvider,
    ReactServerTemplateProvider,
    RouterLocaleProvider,
    SSRManifestProvider,
    ReactPageServerService,
  ],
  register: (alepha) =>
    alepha
      .with(AlephaReact)
      .with(AlephaReactHead)
      .with(AlephaDateTime)
      .with(AlephaServer)
      .with(AlephaServerEtag)
      .with(AlephaServerLinks)
      .with({
        provide: ReactPageService,
        use: ReactPageServerService,
      })
      .with(SSRManifestProvider)
      .with(ReactServerTemplateProvider)
      .with(ReactPreloadProvider)
      .with(ReactServerProvider)
      .with(ReactServerErrorProvider)
      .with(RouterLocaleProvider)
      .with(ReactPageProvider)
      .with(ReactRouter),
});
