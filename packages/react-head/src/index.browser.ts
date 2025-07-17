import { $module } from "@alepha/core";
import { AlephaReact } from "@alepha/react";
import { BrowserHeadProvider } from "./providers/BrowserHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./hooks/useHead.ts";
export * from "./interfaces/Head.ts";
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
	services: [AlephaReact, BrowserHeadProvider],
});
