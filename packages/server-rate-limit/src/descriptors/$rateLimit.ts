import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import type { ServerRequest } from "@alepha/server";
import type { RateLimitOptions } from "../index.ts";
import {
	type RateLimitResult,
	ServerRateLimitProvider,
} from "../providers/ServerRateLimitProvider.ts";

/**
 * Declares rate limiting for server actions or custom usage.
 * This descriptor provides methods to check rate limits and configure behavior
 * within the server request/response cycle.
 */
export const $rateLimit = (
	options: RateLimitDescriptorOptions = {},
): AbstractRateLimitDescriptor => {
	return createDescriptor(RateLimitDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RateLimitDescriptorOptions extends RateLimitOptions {
	/** Name identifier for this rate limit (default: property key) */
	name?: string;
}

export interface AbstractRateLimitDescriptor {
	readonly name: string;
	readonly options: RateLimitDescriptorOptions;
	check(
		request: ServerRequest,
		options?: RateLimitOptions,
	): Promise<RateLimitResult>;
}

export class RateLimitDescriptor
	extends Descriptor<RateLimitDescriptorOptions>
	implements AbstractRateLimitDescriptor
{
	protected readonly serverRateLimitProvider = $inject(ServerRateLimitProvider);

	public get name(): string {
		return this.options.name ?? `${this.config.propertyKey}`;
	}

	/**
	 * Checks rate limit for the given request using this descriptor's configuration.
	 */
	public async check(
		request: ServerRequest,
		options?: RateLimitOptions,
	): Promise<RateLimitResult> {
		const mergedOptions = { ...this.options, ...options };
		return this.serverRateLimitProvider.checkLimit(request, mergedOptions);
	}
}

$rateLimit[KIND] = RateLimitDescriptor;
