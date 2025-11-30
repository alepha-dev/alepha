import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaServer } from "alepha/server";
import { AlephaServerLinks } from "alepha/server/links";
import { $page } from "./primitives/$page.ts";
import { ReactBrowserProvider } from "./providers/ReactBrowserProvider.ts";
import { ReactBrowserRendererProvider } from "./providers/ReactBrowserRendererProvider.ts";
import { ReactBrowserRouterProvider } from "./providers/ReactBrowserRouterProvider.ts";
import { ReactPageProvider } from "./providers/ReactPageProvider.ts";
import { ReactPageService } from "./services/ReactPageService.ts";
import { ReactRouter } from "./services/ReactRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./index.shared-router.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactBrowserRouterProvider.ts";
export * from "./providers/ReactPageProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaReact = $module({
  name: "alepha.react",
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
      .with(AlephaDateTime)
      .with(AlephaServer)
      .with(AlephaServerLinks)
      .with(ReactPageProvider)
      .with(ReactBrowserProvider)
      .with(ReactBrowserRouterProvider)
      .with(ReactBrowserRendererProvider)
      .with(ReactRouter),
});
