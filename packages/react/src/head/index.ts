import { AlephaReact } from "@alepha/react";
import { $module } from "alepha";
import { $head } from "./primitives/$head.ts";
import { BrowserHeadProvider } from "./providers/BrowserHeadProvider.ts";
import { HeadProvider } from "./providers/HeadProvider.ts";
import { SeoExpander } from "./helpers/SeoExpander.ts";
import { ServerHeadProvider } from "./providers/ServerHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$head.ts";
export * from "./hooks/useHead.ts";
export * from "./interfaces/Head.ts";
export * from "./helpers/SeoExpander.ts";
export * from "./providers/ServerHeadProvider.ts";
export * from "./providers/BrowserHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Fill `<head>` server & client side.
 *
 * Generate SEO-friendly meta tags and titles for your React application using AlephaReactHead module.
 *
 * This module provides services and primitives to manage the document head both on the server and client side,
 * ensuring that your application is optimized for search engines and social media sharing.
 *
 * @see {@link ServerHeadProvider}
 * @module alepha.react.head
 */
export const AlephaReactHead = $module({
  name: "alepha.react.head",
  primitives: [$head],
  services: [
    AlephaReact,
    BrowserHeadProvider,
    HeadProvider,
    SeoExpander,
    ServerHeadProvider,
  ],
});
