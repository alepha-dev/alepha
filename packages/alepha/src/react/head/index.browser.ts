import { $module } from "alepha";
import { AlephaReact } from "alepha/react";
import { $head } from "./primitives/$head.ts";
import { BrowserHeadProvider } from "./providers/BrowserHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./helpers/SeoExpander.ts";
export * from "./hooks/useHead.ts";
export * from "./interfaces/Head.ts";
export * from "./primitives/$head.ts";
export * from "./providers/BrowserHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha React Head Module
 *
 * @see {@link BrowserHeadProvider}
 * @module alepha.react.head
 */
export const AlephaReactHead = $module({
  name: "alepha.react.head",
  primitives: [$head],
  services: [AlephaReact, BrowserHeadProvider],
});
