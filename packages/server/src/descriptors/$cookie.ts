import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
	$cursor,
	DateTimeProvider,
	type DurationLike,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { Cookie, CookieManager } from "../helpers/CookieManager";

/**
 *
 */
export interface CookieDescriptorOptions<T extends TSchema> {
	schema: T;

	/**
	 *
	 */
	name: string;

	/**
	 *
	 */
	path?: string; // default: "/"

	/**
	 *
	 */
	ttl?: DurationLike; // map to maxAge

	/**
	 *
	 */
	secure?: boolean; // TODO: "auto" - secure=true if ctx.url.protocol === "https"

	/**
	 *
	 */
	httpOnly?: boolean;

	/**
	 *
	 */
	sameSite?: "strict" | "lax" | "none"; // default: "lax"

	/**
	 *
	 */
	domain?: string;

	/**
	 *
	 */
	compress?: boolean;

	/**
	 *
	 */
	encrypt?: boolean; // not implemented yet

	/**
	 *
	 */
	sign?: boolean; // not implemented yet
}

/**
 *
 */
export interface CookieDescriptor<T extends TSchema> {
	/**
	 *
	 */
	options: CookieDescriptorOptions<T>;

	/**
	 *
	 */
	set: (cookies: CookieManager, value: Static<T>) => void;

	/**
	 *
	 */
	get: (cookies: CookieManager) => Static<T> | undefined;

	/**
	 *
	 */
	del: (cookies: CookieManager) => void;
}

/**
 *
 * @param options
 */
export const $cookie = <T extends TSchema>(
	options: CookieDescriptorOptions<T>,
): CookieDescriptor<T> => {
	const { context } = $cursor();

	return {
		options,

		get: (cookies: CookieManager) => {
			try {
				if (cookies.req[options.name]) {
					let value: string = decodeURIComponent(cookies.req[options.name]);

					if (options.compress) {
						value = inflateRawSync(Buffer.from(value, "base64")).toString(
							"utf8",
						);
					}

					return context.parse(options.schema, JSON.parse(value));
				}
			} catch (e) {
				context.log.error(e);
				cookies.res[options.name] = null;
			}

			return undefined;
		},

		del: (cookies: CookieManager) => {
			cookies.res[options.name] = null;
		},

		set: (cookies: CookieManager, data: Static<T>) => {
			let value = JSON.stringify(context.parse(options.schema, data));

			if (options.compress) {
				value = deflateRawSync(value).toString("base64");
			}

			value = encodeURIComponent(value);

			const cookie: Cookie = {
				value,
				path: options.path ?? "/",
				sameSite: options.sameSite ?? "lax",
				secure: options.secure,
				httpOnly: options.httpOnly,
				domain: options.domain,
			};

			if (options.ttl) {
				const dt = context.get(DateTimeProvider);
				cookie.maxAge = dt.duration(options.ttl).as("seconds");
			}

			cookies.res[options.name] = cookie;
		},
	};
};
