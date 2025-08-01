import { $module } from "@alepha/core";
import {
	AlephaReact,
	type PageConfigSchema,
	type TPropsDefault,
	type TPropsParentDefault,
} from "@alepha/react";
import { $head } from "./descriptors/$head.ts";
import type { Head } from "./interfaces/Head.ts";
import { ServerHeadProvider } from "./providers/ServerHeadProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$head.ts";
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
 * Fill `<head>` server & client side.
 *
 * @see {@link ServerHeadProvider}
 * @module alepha.react.head
 */
export const AlephaReactHead = $module({
	name: "alepha.react.head",
	descriptors: [$head],
	services: [AlephaReact, ServerHeadProvider],
});
