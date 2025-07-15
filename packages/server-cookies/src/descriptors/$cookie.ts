import {
	__descriptor,
	KIND,
	NotImplementedError,
	OPTIONS,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";

const KEY = "COOKIE";

/**
 * Declares a type-safe, configurable HTTP cookie.
 * This descriptor provides methods to get, set, and delete the cookie
 * within the server request/response cycle.
 */
export const $cookie: {
	<T extends TSchema>(options: CookieDescriptorOptions<T>): CookieDescriptor<T>;
	[KIND]: string;
} = <T extends TSchema>(
	options: CookieDescriptorOptions<T>,
): CookieDescriptor<T> => {
	__descriptor(KEY);

	const api: Partial<CookieDescriptor<T>> = {
		[KIND]: KEY,
		[OPTIONS]: options,
		schema: options.schema,
		set: () => {
			throw new NotImplementedError(KEY);
		},
		get: () => {
			throw new NotImplementedError(KEY);
		},
		del: () => {
			throw new NotImplementedError(KEY);
		},
	};

	return api as CookieDescriptor<T>;
};

$cookie[KIND] = KEY;

// ---------------------------------------------------------------------------------------------------------------------

export interface CookieDescriptorOptions<T extends TSchema> {
	/** The schema for the cookie's value, used for validation and type safety. */
	schema: T;

	/** The name of the cookie. */
	name?: string;

	/** The cookie's path. Defaults to "/". */
	path?: string;

	/** Time-to-live for the cookie. Maps to `Max-Age`. */
	ttl?: DurationLike;

	/** If true, the cookie is only sent over HTTPS. Defaults to true in production. */
	secure?: boolean;

	/** If true, the cookie cannot be accessed by client-side scripts. */
	httpOnly?: boolean;

	/** SameSite policy for the cookie. Defaults to "lax". */
	sameSite?: "strict" | "lax" | "none";

	/** The domain for the cookie. */
	domain?: string;

	/** If true, the cookie value will be compressed using zlib. */
	compress?: boolean;

	/** If true, the cookie value will be encrypted. Requires `COOKIE_SECRET` env var. */
	encrypt?: boolean;

	/** If true, the cookie will be signed to prevent tampering. Requires `COOKIE_SECRET` env var. */
	sign?: boolean;
}

export interface CookieDescriptor<T extends TSchema> {
	[KIND]: typeof KEY;
	[OPTIONS]: CookieDescriptorOptions<T>;

	schema: T;

	/** Sets the cookie with the given value in the current request's response. */
	set: (value: Static<T>, options?: { cookies?: Cookies }) => void;

	/** Gets the cookie value from the current request. Returns undefined if not found or invalid. */
	get: (options?: { cookies?: Cookies }) => Static<T> | undefined;

	/** Deletes the cookie in the current request's response. */
	del: (options?: { cookies?: Cookies }) => void;
}

export interface Cookies {
	req: Record<string, string>;
	res: Record<string, Cookie | null>;
}

export interface Cookie {
	value: string;
	path?: string;
	maxAge?: number;
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: "strict" | "lax" | "none";
	domain?: string;
}
