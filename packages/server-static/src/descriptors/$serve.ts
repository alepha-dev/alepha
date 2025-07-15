import { __descriptor, KIND, NotImplementedError, OPTIONS } from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";

const KEY = "SERVE";

/**
 * Create a new static file handler.
 */
export const $serve: {
	(options?: ServeDescriptorOptions): ServeDescriptor;
	[KIND]: string;
} = (options: ServeDescriptorOptions = {}): ServeDescriptor => {
	__descriptor(KEY);
	return {
		[KIND]: KEY,
		[OPTIONS]: options,
		list: () => {
			throw new NotImplementedError(KEY);
		},
	};
};

$serve[KIND] = KEY;

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
	 * Force all requests "not found" to be served with the index.html file.
	 * This is useful for single-page applications (SPAs) that use client-side only routing.
	 */
	historyApiFallback?: boolean;

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
	 * @default {}
	 */
	cacheControl?: Partial<CacheControlOptions> | false;
}

export interface CacheControlOptions {
	/**
	 * Whether to use cache control headers.
	 *
	 * @default [.js, .css]
	 */
	fileTypes: string[];

	/**
	 * The maximum age of the cache in seconds.
	 *
	 * @default 60 * 60 * 24 * 2 // 2 days
	 */
	maxAge: DurationLike;

	/**
	 * Whether to use immutable cache control headers.
	 *
	 * @default true
	 */
	immutable: boolean;
}

export interface ServeDescriptor {
	[KIND]: typeof KEY;
	[OPTIONS]: ServeDescriptorOptions;
	list(): string[];
}
