import type { Alepha, Env } from "./Alepha.ts";
import type { Async } from "./interfaces/Async.ts";

export * from "./Alepha.ts";

export * from "./constants/KIND.ts";
export * from "./constants/OPTIONS.ts";

export * from "./descriptors/$cursor.ts";
export * from "./descriptors/$hook.ts";
export * from "./descriptors/$inject.ts";
export * from "./descriptors/$logger.ts";
export * from "./descriptors/$retry.ts";

export * from "./errors/AppNotStartedError.ts";
export * from "./errors/CircularDependencyError.ts";
export * from "./errors/ContainerLockedError.ts";
export * from "./errors/NotImplementedError.ts";
export * from "./errors/TypeBoxError.ts";

export * from "./helpers/descriptor.ts";

export * from "./interfaces/Async.ts";
export * from "./interfaces/Service.ts";

export * from "./providers/AsyncLocalStorageProvider.ts";
export * from "./providers/TypeProvider.ts";

export * from "./services/Logger.ts";

export const substitute = <T extends object>(
	provide: T,
	use: T,
): {
	use: T;
	provide: T;
} => ({
	provide,
	use,
});

export interface RunOptions {
	/**
	 * Environment variables to be used by the application.
	 * If not provided, it will use the current process environment.
	 */
	env?: Env;

	/**
	 * A callback that will be executed before the application starts.
	 */
	configure?: (alepha: Alepha) => Async<void>;

	/**
	 * A callback that will be executed once the application is ready.
	 * This is useful for initializing resources or starting background tasks.
	 */
	ready?: (alepha: Alepha) => Async<void>;

	/**
	 * If true, the application will stop after the ready callback is executed.
	 */
	once?: boolean;
}
