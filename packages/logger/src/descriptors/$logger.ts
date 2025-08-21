import { $cursor, $inject, KIND } from "@alepha/core";
import { Logger } from "../services/Logger.ts";

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
 * 	    // print something like '[23:45:53.326] INFO <app.App>: App is ready!'
 * 		this.log.info("Service initialized");
 * 	}
 * }
 * ```
 */
export const $logger = (options: LoggerDescriptorOptions = {}): Logger => {
	const { context, definition, module } = $cursor();

	return $inject(Logger, {
		skipCache: true,
		skipRegistration: true,
		args: [
			options.name ?? definition?.name,
			module?.name ?? context.env.MODULE_NAME ?? "app",
		],
	});
};

export interface LoggerDescriptorOptions {
	name?: string;
}

$logger[KIND] = Logger;
