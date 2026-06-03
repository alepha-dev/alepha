import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaReact } from "alepha/react";
import { AlephaReactHead } from "alepha/react/head";
import { AlephaServer } from "alepha/server";
import { AlephaServerLinks } from "alepha/server/links";
import { $page } from "./primitives/$page.ts";
import { ReactBrowserProvider } from "./providers/ReactBrowserProvider.ts";
import { ReactBrowserRendererProvider } from "./providers/ReactBrowserRendererProvider.ts";
import { ReactBrowserRouterProvider } from "./providers/ReactBrowserRouterProvider.ts";
import { ReactPageProvider } from "./providers/ReactPageProvider.ts";
import { RouterLocaleProvider } from "./providers/RouterLocaleProvider.ts";
import { ReactPageService } from "./services/ReactPageService.ts";
import { ReactRouter } from "./services/ReactRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactBrowserRendererProvider.ts";
export * from "./providers/ReactBrowserRouterProvider.ts";
export * from "./providers/RouterLocaleProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaReactRouter = $module({
  name: "alepha.react.router",
  primitives: [$page],
  services: [
    ReactPageProvider,
    ReactBrowserRouterProvider,
    ReactBrowserProvider,
    ReactRouter,
    ReactBrowserRendererProvider,
    RouterLocaleProvider,
    ReactPageService,
  ],
  register: (alepha) =>
    alepha
      .with(AlephaReact)
      .with(AlephaReactHead)
      .with(AlephaDateTime)
      .with(AlephaServer)
      .with(AlephaServerLinks)
      .with(ReactPageProvider)
      .with(ReactBrowserProvider)
      .with(ReactBrowserRouterProvider)
      .with(ReactBrowserRendererProvider)
      .with(RouterLocaleProvider)
      .with(ReactRouter),
});
