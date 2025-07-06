import type { Logger } from "../services/Logger.ts";
import { $cursor } from "./$cursor.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Create a logger.
 *
 * `name` is optional, by default it will use the name of the service.
 *
 * @example
 * ```ts
 * import { $logger } from "@alepha/core";
 *
 * class MyService {
 * 	log = $logger();
 *
 * 	constructor() {
 * 	    // print something like 'date - [MyService] Service initialized'
 * 		this.log.info("Service initialized");
 * 	}
 * }
 * ```
 */
export const $logger = (name?: string): Logger => {
	const { context, definition, module } = $cursor();

	return context.log.child({
		caller: name ?? definition?.name,
		name: module?.name ?? context.env.APP_NAME ?? "app",
	});
};

// ---------------------------------------------------------------------------------------------------------------------
