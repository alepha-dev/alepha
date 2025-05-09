import { $cache } from "@alepha/cache";
import {
	$inject,
	Alepha,
	type DurationLike,
	EventEmitter,
	type TSchema,
	t,
} from "@alepha/core";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
	ClientRequestEntry,
	ClientRequestOptions,
	RouteDescriptor,
} from "../descriptors/$action.ts";
import { HttpError } from "../errors/HttpError.ts";
import { UnauthorizedError } from "../errors/UnauthorizedError.ts";
import type {
	RequestConfigSchema,
	ServerHandler,
	ServerRequestConfigEntry,
} from "../providers/ServerRouterProvider.ts";
import { errorSchema } from "../schemas/errorSchema.ts";

const envSchema = t.object({
	SERVER_API_URL: t.string({
		default: "/api",
	}),
});

export class HttpClient extends EventEmitter<{
	onError: HttpError;
	beforeFetch: FetchBeforeHook;
}> {
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);

	public readonly URL_LINKS = "/_links";
	public readonly cache = $cache<any>();
	public links?: Array<HttpClientLink>;

	protected readonly pendingRequests: HttpClientPendingRequests = {};
	protected host = "";

	public json<T = any>(url: string, options?: RequestInit): Promise<T> {
		return this.fetch(url, { method: "GET", ...options }, { schema: t.any() });
	}

	public async clear() {
		await this.cache.invalidate();
	}

	public createFetchFunction(
		link: HttpClientLink,
		options?: FetchFactoryAdditionalOptions,
	) {
		return (
			config: Partial<ClientRequestEntry> = {},
			fetchOptions: ClientRequestOptions = {},
		) => {
			const host =
				typeof options?.host === "function" ? options.host() : options?.host;
			return this.request({
				config,
				fetch: fetchOptions,
				link,
				host: host ?? this.host,
			});
		};
	}

	public async request(args: {
		link: HttpClientLink;
		fetch?: ClientRequestOptions;
		config?: ServerRequestConfigEntry;
		host?: string;
	}) {
		const route = args.link;
		const options = args.fetch ?? {};
		const config = args.config ?? {};
		const host = args.host ?? "";

		const request: RequestInit = {
			...options.request,
		};

		const method = route.method;
		const headers: Record<string, string> = {};

		const url = this.url(host, route, config);
		const cacheKey = url.replace(host, "");

		const data = await this.cache.get(cacheKey);
		if (data && method === "GET") {
			return data;
		}

		await this.emit("beforeFetch", {
			route,
			config,
			options,
			headers,
			request,
		});

		request.method = method;

		await this.body(request, headers, route, config);

		request.headers = {
			...config.headers,
			...request.headers,
			...headers,
		};

		const response = await this.fetch(url, request, {
			schema: route.schema?.response,
		});

		if (options.cache !== undefined && method === "GET") {
			await this.cache.set(
				cacheKey,
				response,
				typeof options.cache === "boolean" ? undefined : options.cache,
			);
		}

		return response;
	}

	protected url(
		host: string,
		link: HttpClientLink,
		args: ServerRequestConfigEntry,
	) {
		let url = host + link.path;

		url = this.pathVariables(url, link, args);

		url = this.queryParams(url, link, args);

		return url;
	}

	protected async body(
		init: RequestInit,
		headers: Record<string, string>,
		link: HttpClientLink,
		args: ServerRequestConfigEntry = {},
	) {
		const hasHeader =
			typeof init.headers === "object" &&
			"content-type" in init.headers &&
			init.headers["content-type"] === "multipart/form-data";
		if (link.contentType === "multipart/form-data" || hasHeader) {
			if (hasHeader) {
				// @ts-ignore
				delete init.headers["content-type"];
			}

			const formData = new FormData();

			for (const [key, value] of Object.entries(args.body ?? {})) {
				if (typeof value === "string") {
					formData.append(key, value);
					continue;
				}
				if (value instanceof Blob) {
					formData.append(key, value);
				}
			}

			init.body = formData;

			return;
		}

		if (!init.body && link.schema?.body) {
			init.body = JSON.stringify(
				this.alepha.parse(link.schema?.body, args.body),
			);
		}

		if (init.body) {
			headers["content-type"] = "application/json";
		}
	}

	public async fetch<T>(
		url: string,
		request: RequestInit,
		options: FetchRunOptions = {},
	): Promise<T> {
		// make a key for the request
		// this will be used to check if the request is already pending
		const key = JSON.stringify({
			url,
			method: request.method,
			body: request.body,
		});

		const existing = this.pendingRequests[key];
		if (existing) {
			return existing;
		}

		const pendingRequest = fetch(url, request)
			.then((response) => this.response(response, options))
			.finally(() => {
				delete this.pendingRequests[key];
			});

		// If the request is a POST request, we won't reuse the promise.
		if (request.method === "POST") {
			return pendingRequest;
		}

		this.pendingRequests[key] = pendingRequest;

		return this.pendingRequests[key];
	}

	/**
	 * Parse the response.
	 *
	 * @param response
	 * @param options
	 * @protected
	 */
	protected async response(
		response: Response,
		options: FetchRunOptions,
	): Promise<Response | any> {
		if (options.schema) {
			if (response.status === 204) {
				return;
			}

			const text = await response.text();

			const json = JSON.parse(text);

			if (response.status >= 400) {
				const jsonError = this.alepha.parse(errorSchema, json);
				const error = new HttpError(jsonError);

				await this.emit("onError", error);

				throw error;
			}

			return this.alepha.parse(options.schema, json);
		}

		return response;
	}

	protected pathVariables(
		url: string,
		action: HttpClientLink,
		args: ServerRequestConfigEntry = {},
	): string {
		if (action.schema?.params && typeof args.params === "object") {
			const params = this.alepha.parse(
				action.schema.params,
				args.params,
			) as Record<string, any>;

			for (const key of Object.keys(params)) {
				url = url.replace(`:${key}`, params[key]);
				url = url.replace(`{${key}}`, params[key]);
			}
		}

		return url;
	}

	protected queryParams(
		url: string,
		action: HttpClientLink,
		args: ServerRequestConfigEntry = {},
	): string {
		if (action.schema?.query && typeof args.query === "object") {
			return `${url}?${new URLSearchParams(
				this.alepha.parse(action.schema.query, args.query ?? {}) as Record<
					string,
					string
				>,
			).toString()}`;
		}
		return url;
	}

	public of<T extends object>(
		options: {
			group?: string;
			host?: string | (() => string);
		} = {},
	): HttpVirtualClient<T> {
		return new Proxy<HttpVirtualClient<T>>({} as HttpVirtualClient<T>, {
			get: (_, prop) => {
				if (typeof prop !== "string") {
					return;
				}

				const $ = async (config: any = {}, args: ClientRequestOptions = {}) => {
					const host: string | undefined =
						typeof options.host === "function" ? options.host() : options.host;

					const links = await this.getLinks({
						host,
					});

					const link = links.find((a) => a.name === prop);

					if (!link) {
						const error = new UnauthorizedError(`Action ${prop} not found.`);
						await this.emit("onError", error);
						throw error;
					}

					// if a handler is defined, use it (ssr)
					if (link.handler) {
						return link.handler({
							method: link.method,
							url: new URL(`http://localhost${link.path}`),
							query: config.query ?? {},
							body: config.body ?? {},
							params: config.params ?? {},
							headers: config.headers ?? {},
							metadata: {},
							cookies: { req: {}, res: {} },
							raw: {},
							reply: {
								headers: {},
								redirect: () => {},
							},
						});
					}

					// else, make a request
					return this.request({
						host,
						config,
						link: {
							...link,
							schema: {
								body: t.any(),
								query: t.any(),
								params: t.any(),
								response: t.any(),
							},
						},
						fetch: args,
					});
				};

				$.fetch = (config: any, args: ClientRequestOptions = {}) => {
					return $(config, args);
				};

				$.can = () => {
					return this.can(prop);
				};

				$.permissions = () => {
					return prop;
				};

				return $;
			},
		});
	}

	public can(name: string) {
		const links = this.alepha.isBrowser()
			? this.links
			: this.alepha.als.get<HttpClientLink[]>("links");

		return !!links?.some((link) => link.name === name);
	}

	public async getLinks(
		opts: { force?: boolean; host?: string } = {},
	): Promise<HttpClientLink[]> {
		if (!this.links || opts.force) {
			const host = opts.host ?? "";
			this.links = await this.json<any[]>(
				`${host}${this.env.SERVER_API_URL}${this.URL_LINKS}`,
			);
		}

		return this.links;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export interface FetchBeforeHook {
	route: HttpClientLink;
	config: ServerRequestConfigEntry;
	options: ClientRequestOptions;
	headers: Record<string, string>;
	request: RequestInit;
}

export type HttpClientPendingRequests = Record<
	string,
	Promise<any> | undefined
>;

export interface FetchFactoryAdditionalOptions {
	host?: string | (() => string);
}

export interface FetchRunOptions {
	schema?: TSchema;
	raw?: boolean;
	cache?: boolean | DurationLike;
}

export interface HttpClientLink {
	method: RouteMethod;
	path: string;
	name: string;
	group?: string;
	contentType?: string; // application/json or multipart/form-data
	protected?: boolean;
	// only for server actions, not for client actions
	schema?: RequestConfigSchema;
	handler?: ServerHandler;
}

export type HttpVirtualClient<T> = {
	[K in keyof T as T[K] extends RouteDescriptor ? K : never]: T[K] & {
		can: () => boolean;
	};
};
