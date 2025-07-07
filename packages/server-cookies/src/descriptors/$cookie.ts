import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
	__descriptor,
	$cursor,
	KIND,
	OPTIONS,
	type Static,
	type TSchema,
} from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import type { ServerRequest } from "@alepha/server";

export interface CookieDescriptorOptions<T extends TSchema> {
	schema: T;

	name: string;

	path?: string; // default: "/"

	ttl?: DurationLike; // map to maxAge

	secure?: boolean; // TODO: "auto" - secure=true if ctx.url.protocol === "https"

	httpOnly?: boolean;

	sameSite?: "strict" | "lax" | "none"; // default: "lax"

	domain?: string;

	compress?: boolean;

	encrypt?: boolean; // not implemented yet

	sign?: boolean; // not implemented yet
}

export interface CookieDescriptor<T extends TSchema> {
	[KIND]: "COOKIE";

	[OPTIONS]: CookieDescriptorOptions<T>;

	set: (value: Static<T>, options?: { cookies?: Cookies }) => void;

	get: (options?: { cookies?: Cookies }) => Static<T> | undefined;

	del: (options?: { cookies?: Cookies }) => void;
}

export const $cookie: {
	<T extends TSchema>(options: CookieDescriptorOptions<T>): CookieDescriptor<T>;
	[KIND]: string;
} = <T extends TSchema>(
	options: CookieDescriptorOptions<T>,
): CookieDescriptor<T> => {
	__descriptor("COOKIE");

	const { context: alepha } = $cursor();

	return {
		[KIND]: "COOKIE",
		[OPTIONS]: options,
		get: (opts: { cookies?: Cookies } = {}) => {
			const cookies =
				alepha.context.get<ServerRequest>("request")?.cookies ?? opts.cookies;
			if (!cookies) {
				throw new Error(
					"Cookies not found in request context or options.cookies",
				);
			}

			try {
				if (cookies.req[options.name]) {
					let value: string = decodeURIComponent(cookies.req[options.name]);

					if (options.compress) {
						value = inflateRawSync(Buffer.from(value, "base64")).toString(
							"utf8",
						);
					}

					return alepha.parse(options.schema, JSON.parse(value));
				}
			} catch (e) {
				alepha.log.error(e);
				cookies.res[options.name] = null;
			}

			return undefined;
		},

		del: (opts: { cookies?: Cookies } = {}) => {
			const cookies =
				alepha.context.get<ServerRequest>("request")?.cookies ?? opts.cookies;
			if (!cookies) {
				throw new Error(
					"Cookies not found in request context or options.cookies",
				);
			}

			cookies.res[options.name] = null;
		},

		set: (data: Static<T>, opts: { cookies?: Cookies } = {}) => {
			const cookies =
				alepha.context.get<ServerRequest>("request")?.cookies ?? opts.cookies;
			if (!cookies) {
				throw new Error(
					"Cookies not found in request context or options.cookies",
				);
			}

			let value = JSON.stringify(alepha.parse(options.schema, data));

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
				const dt = alepha.get(DateTimeProvider);
				cookie.maxAge = dt.duration(options.ttl).as("seconds");
			}

			cookies.res[options.name] = cookie;
		},
	};
};

$cookie[KIND] = "COOKIE";

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
