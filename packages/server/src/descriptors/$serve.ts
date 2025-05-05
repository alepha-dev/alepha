import { type DurationLike, KIND, __descriptor } from "@alepha/core";
import { NotImplementedError } from "@alepha/core";

const KEY = "SERVE";

export interface ServeDescriptorOptions {
	/**
	 * Prefix for the served path.
	 *
	 * @default "/"
	 */
	path?: string;

	/**
	 * Path to the directory to serve.
	 *
	 * @default process.cwd()
	 */
	root?: string;

	/**
	 * If true, descriptor will be ignored.
	 *
	 * @default false
	 */
	disabled?: boolean;

	/**
	 * Whether to keep dot files (e.g. `.gitignore`, `.env`) in the served directory.
	 *
	 * @default true
	 */
	ignoreDotEnvFiles?: boolean;

	/**
	 * Whether to use the index.html file when the path is a directory.
	 *
	 * @default true
	 */
	indexFallback?: boolean;

	/**
	 * Optional name of the descriptor.
	 * This is used for logging and debugging purposes.
	 *
	 * @default Key name.
	 */
	name?: string;

	/**
	 * Whether to use cache control headers.
	 *
	 * @default false
	 */
	cacheControl?: boolean;

	/**
	 * Whether to use immutable cache control headers.
	 *
	 * @default false
	 */
	immutable?: boolean;

	/**
	 * The maximum age of the cache in seconds.
	 *
	 * @default 0
	 */
	maxAge?: DurationLike;
}

export interface ServeDescriptor {
	[KIND]: typeof KEY;
	options: ServeDescriptorOptions;
	list(): string[];
}

export const $serve = (
	options: ServeDescriptorOptions = {},
): ServeDescriptor => {
	__descriptor(KEY);
	return {
		[KIND]: KEY,
		options,
		list: () => {
			throw new NotImplementedError(KEY);
		},
	};
};

$serve[KIND] = KEY;
