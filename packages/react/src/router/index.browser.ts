import { $module } from "alepha";
import { $page } from "./primitives/$page.ts";
import { ReactRouter } from "./services/ReactRouter.ts";
import { ReactBrowserRendererProvider } from "./providers/ReactBrowserRendererProvider.ts";
import { ReactBrowserRouterProvider } from "./providers/ReactBrowserRouterProvider.ts";
import { ReactPageService } from "./services/ReactPageService.ts";
import { ReactPageProvider } from "./providers/ReactPageProvider.ts";
import { ReactBrowserProvider } from "./providers/ReactBrowserProvider.ts";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaServer } from "alepha/server";
import { AlephaServerLinks } from "alepha/server/links";
import { AlephaReact } from "@alepha/react";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/ReactBrowserProvider.ts"
export * from "./providers/ReactBrowserRouterProvider.ts"
export * from "./providers/ReactBrowserRendererProvider.ts"

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
    ReactPageService,
  ],
  register: (alepha) =>
    alepha
      .with(AlephaReact)
      .with(AlephaDateTime)
      .with(AlephaServer)
      .with(AlephaServerLinks)
      .with(ReactPageProvider)
      .with(ReactBrowserProvider)
      .with(ReactBrowserRouterProvider)
      .with(ReactBrowserRendererProvider)
      .with(ReactRouter),
});

