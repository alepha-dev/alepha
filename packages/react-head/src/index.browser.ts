import { __bind, type Alepha, type Module } from "@alepha/core";
import { $page, AlephaReact } from "@alepha/react";
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
export class AlephaReactHead implements Module {
	public readonly name = "alepha.react.head";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(AlephaReact).with(BrowserHeadProvider);
}

__bind($page, AlephaReactHead);
