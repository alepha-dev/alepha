import { $module } from "alepha";
import { AlephaReact } from "alepha/react";

import { SeoExpander } from "./helpers/SeoExpander.ts";
import { $head } from "./primitives/$head.ts";
import { BrowserHeadProvider } from "./providers/BrowserHeadProvider.ts";
import { HeadProvider } from "./providers/HeadProvider.ts";
import { ServerHeadProvider } from "./providers/ServerHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./helpers/SeoExpander.ts";
export * from "./hooks/useHead.ts";
export * from "./interfaces/Head.ts";
export * from "./primitives/$head.ts";
export * from "./providers/BrowserHeadProvider.ts";
export * from "./providers/ServerHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * HTML head element management.
 *
 * **Features:**
 * - Title, meta tags, and links
 * - SEO optimization
 * - Social media tags
 *
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
