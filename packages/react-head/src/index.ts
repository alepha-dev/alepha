import type { Alepha, Module } from "@alepha/core";
import {
	AlephaReact,
	type PageConfigSchema,
	type TPropsDefault,
	type TPropsParentDefault,
} from "@alepha/react";
import type { Head } from "./interfaces/Head.ts";
import { ServerHeadProvider } from "./providers/ServerHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./hooks/useHead.ts";
export * from "./interfaces/Head.ts";
export * from "./providers/ServerHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/react" {
	interface PageDescriptorOptions<
		TConfig extends PageConfigSchema = PageConfigSchema,
		TProps extends object = TPropsDefault,
		TPropsParent extends object = TPropsParentDefault,
	> {
		head?: Head | ((props: TProps, previous?: Head) => Head);
	}

	interface PageReactContext {
		head: Head;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha React Head Module
 *
 * @see {@link ServerHeadProvider}
 * @module alepha.react.head
 */
export class AlephaReactHead implements Module {
	public readonly name = "alepha.react.head";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(AlephaReact).with(ServerHeadProvider);
}
