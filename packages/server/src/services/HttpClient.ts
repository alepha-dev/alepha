import { $cache } from "@alepha/cache";
import {
	type DurationLike,
	EventEmitter,
	type TSchema,
	TypeGuard,
} from "@alepha/core";
import { $inject, Alepha, t } from "@alepha/core";
import type {
	RequestConfig,
	RouteDescriptor,
	RouteDescriptorOptions,
	RouteFetchRequestOptions,
	RouteMethod,
	RouteRequestArgs,
} from "../descriptors/$route";
import { HttpError } from "../errors/HttpError";
import { UnauthorizedError } from "../errors/UnauthorizedError";
import { errorSchema } from "../schemas/errorSchema";

const envSchema = t.object({
	SERVER_API_URL: t.string({
		default: "/api",
	}),
});

/**
 *
 */
export class HttpClient extends EventEmitter<{
	onError: HttpError;
	beforeFetch: FetchBeforeHook;
}> {
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);

	public readonly URL_LINKS = "/_links";
	public readonly cache = $cache();
	public links?: Array<HttpClientLink>;

	protected readonly pendingRequests: HttpClientPendingRequests = {};
	protected host = "";

	/**
	 *
	 * @param url
	 * @param options
	 */
	public json<T = any>(url: string, options?: RequestInit): Promise<T> {
		return this.fetch(url, { method: "GET", ...options }, { schema: t.any() });
	}

	/**
	 *
	 */
	public async clear() {
		await this.cache.invalidate();
	}

	/**
	 * Create a fetcher function.
	 *
	 * @param routeDescriptorOptions - The route descriptor options.
	 * @param additionalArgs - Additional arguments to pass to the fetcher.
	 */
	public createFetcher(
		routeDescriptorOptions: RouteDescriptorOptions<RequestConfig>,
		additionalArgs?: FetchFactoryAdditionalOptions,
	) {
		return (
			config: RouteRequestArgs,
			fetchRequestOptions: RouteFetchRequestOptions = {},
		) => {
			return this.request(
				config,
				fetchRequestOptions,
				routeDescriptorOptions,
				additionalArgs,
			);
		};
	}

	/**
	 *
	 * @param config
	 * @param fetchRequestOptions
	 * @param routeDescriptorOptions
	 * @param additionalArgs
	 */
	public async request(
		config: RouteRequestArgs,
		fetchRequestOptions: RouteFetchRequestOptions = {},
		routeDescriptorOptions: RouteDescriptorOptions<RequestConfig> = {},
		additionalArgs: FetchFactoryAdditionalOptions = {},
	) {
		const init: RequestInit = {
			...fetchRequestOptions.request,
		};

		const method = routeDescriptorOptions.method?.toUpperCase() ?? "GET";
		const headers: Record<string, string> = {};
		const host = additionalArgs?.host ?? "";
		const url = this.url(host, routeDescriptorOptions, config);
		const cacheKey = url.replace(host, "");

		const data = await this.cache.get(cacheKey);
		if (data && method === "GET") {
			return data;
		}

		await this.emit("beforeFetch", {
			route: routeDescriptorOptions,
			config,
			options: fetchRequestOptions,
			headers,
			request: init,
		});

		this.method(init, routeDescriptorOptions);

		await this.body(init, headers, routeDescriptorOptions, config);

		if (fetchRequestOptions.bearer) {
			if (typeof fetchRequestOptions.bearer === "string") {
				headers.Authorization = `Bearer ${fetchRequestOptions.bearer}`;
			} else {
				headers.Authorization = `Bearer ${await fetchRequestOptions.bearer()}`;
			}
		}

		await this.body(init, headers, routeDescriptorOptions, config);

		init.headers = headers;

		const request = {
			...init,
			...fetchRequestOptions.request,
		};

		const response = await this.fetch(url, request, {
			schema: this.getResponseSchema(routeDescriptorOptions.schema),
			safe: fetchRequestOptions.test?.safe,
		});

		if (fetchRequestOptions.cache !== undefined && method === "GET") {
			await this.cache.set(
				cacheKey,
				response,
				typeof fetchRequestOptions.cache === "boolean"
					? undefined
					: fetchRequestOptions.cache,
			);
		}

		return response;
	}

	/**
	 * Get the response schema from the request config.
	 *
	 * @param schema
	 */
	protected getResponseSchema(schema?: RequestConfig): TSchema | undefined {
		if (!schema?.response) return;

		if (TypeGuard.IsSchema(schema.response)) {
			return schema.response;
		}

		const statusCodes = [200, 201, 204] as const;

		for (const code of statusCodes) {
			if (code in schema.response) {
				const response = (schema.response as { [code]: TSchema })[code];
				if (TypeGuard.IsSchema(response)) {
					return response;
				}
			}
		}
	}

	/**
	 * Create the URL for the request.
	 *
	 * @param host
	 * @param options
	 * @param args
	 * @protected
	 */
	protected url(
		host: string,
		options: RouteDescriptorOptions<RequestConfig>,
		args: RouteRequestArgs<RequestConfig>,
	) {
		let url = host + (options.url ?? "/");

		url = this.pathVariables(url, options, args);

		url = this.queryParams(url, options, args);

		return url;
	}

	/**
	 * Set the method for the request.
	 *
	 * @param init
	 * @param options
	 * @protected
	 */
	protected method(
		init: RequestInit,
		options: RouteDescriptorOptions<RequestConfig>,
	) {
		init.method = options.method ?? (options.schema?.body ? "post" : "get");
	}

	/**
	 * Set the body for the request.
	 *
	 * @param init
	 * @param headers
	 * @param options
	 * @param args
	 * @protected
	 */
	protected async body(
		init: RequestInit,
		headers: Record<string, string>,
		options: RouteDescriptorOptions<RequestConfig>,
		args: RouteRequestArgs<RequestConfig> = {},
	) {
		if (options.parse === "multipart/form-data") {
			const formData = new FormData();

			const body = args.body as unknown as Record<string, any>;
			if (options.schema?.body && typeof body === "object") {
				for (const key of Object.keys(body)) {
					if (typeof body[key].toBlob === "function") {
						formData.append(key, body[key].toBlob());
						continue;
					}

					if (typeof body[key].toBuffer === "function") {
						const arr = await body[key].toBuffer();
						formData.append(key, new Blob(arr));
					}
				}
			}

			init.body = formData;

			return;
		}

		if (!init.body && options.schema?.body) {
			init.body = JSON.stringify(
				this.alepha.parse(options.schema?.body, args.body),
			);
		}

		if (init.body) {
			headers["Content-Type"] = "application/json";
		}
	}

	/**
	 * Perform the fetch request.
	 *
	 * @param url
	 * @param request
	 * @param options - {FetchRunOptions}
	 * @protected
	 */
	public async fetch(
		url: string,
		request: RequestInit,
		options: FetchRunOptions,
	) {
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
				return response;
			}

			const json = await response.json();

			if (response.status >= 400) {
				if (options.safe) {
					return json;
				}

				const jsonError = this.alepha.parse(errorSchema, json);

				const error = new HttpError(
					jsonError.statusCode,
					jsonError.code ?? "",
					jsonError.message,
				);

				await this.emit("onError", error);

				throw error;
			}

			return this.alepha.parse(options.schema, json);
		}

		return response;
	}

	/**
	 * Replace path variables in the URL.
	 *
	 * @param url
	 * @param options
	 * @param args
	 * @protected
	 */
	protected pathVariables(
		url: string,
		options: RouteDescriptorOptions<RequestConfig>,
		args: RouteRequestArgs<RequestConfig> = {},
	): string {
		if (options.schema?.params && typeof args.params === "object") {
			const params = this.alepha.parse(
				options.schema.params,
				args.params,
			) as Record<string, any>;

			for (const key of Object.keys(params)) {
				url = url.replace(`:${key}`, params[key]);
				url = url.replace(`{${key}}`, params[key]);
			}
		}

		return url;
	}

	/**
	 * Add query parameters to the URL.
	 *
	 * @param url
	 * @param options
	 * @param args
	 * @protected
	 */
	protected queryParams(
		url: string,
		options: RouteDescriptorOptions<RequestConfig>,
		args: RouteRequestArgs<RequestConfig> = {},
	): string {
		if (options.schema?.query && typeof args.query === "object") {
			return `${url}?${new URLSearchParams(
				this.alepha.parse(options.schema.query, args?.query ?? {}) as Record<
					string,
					string
				>,
			).toString()}`;
		}
		return url;
	}

	/**
	 *
	 * @param options
	 */
	public of<T extends object>(
		options: {
			group?: string;
		} = {},
	): HttpVirtualClient2<T> {
		return new Proxy<HttpVirtualClient2<T>>({} as HttpVirtualClient2<T>, {
			get: (_, prop) => {
				if (typeof prop !== "string") {
					return;
				}

				const $ = async (config: any = {}, options: any = {}) => {
					const links = await this.getLinks();
					const link = links.find((a) => a.name === prop);
					if (!link) {
						const error = new UnauthorizedError(`Action ${prop} not found.`);
						await this.emit("onError", error);
						throw error;
					}

					// if a handler is defined, use it (ssr)
					if (link.handler) {
						return link.handler(
							{
								url: link.url,
								cookies: config.cookies ?? {},
								query: config.query ?? {},
								body: config.body ?? {},
								params: config.params ?? {},
								headers: config.headers ?? {},
							},
							options,
						);
					}

					// else, make a request
					return this.request(config, options, {
						method: link.method,
						url: link.url.startsWith(this.env.SERVER_API_URL)
							? link.url
							: `${this.env.SERVER_API_URL}${link.url}`,
						schema: {
							body: t.any(),
							query: t.any(),
							params: t.any(),
							response: t.any(),
						},
					});
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

	/**
	 * Get the links from the server.
	 *
	 * @param force - Skip the cache and fetch the links again.
	 */
	public async getLinks(force = false): Promise<HttpClientLink[]> {
		if (!this.links || force) {
			this.links = await this.json<any[]>(
				`${this.env.SERVER_API_URL}${this.URL_LINKS}`,
			);
		}

		return this.links;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export interface FetchBeforeHook {
	route: RouteDescriptorOptions<RequestConfig>;
	config: RouteRequestArgs<RequestConfig>;
	options: RouteFetchRequestOptions;
	headers: Record<string, string>;
	request: RequestInit;
}

export type HttpClientPendingRequests = Record<
	string,
	Promise<any> | undefined
>;

export type HttpClientHookFn = (args: FetchBeforeHook) => Promise<void> | void;

export interface FetchFactoryAdditionalOptions {
	host?: string;
}

export interface FetchRunOptions {
	schema?: TSchema;
	raw?: boolean;
	cache?: boolean | DurationLike;
	safe?: boolean;
}

export interface HttpClientLink {
	name: string;
	method: RouteMethod;
	url: string;
	group?: string;
	schema?: any;
	handler?: (config: any, options: any) => Promise<any>;
	protected?: boolean;
}

export type HttpVirtualClient<T> = {
	[K in keyof T]: T[K] extends RouteDescriptor
		? T[K] & {
				can: () => boolean;
			}
		: never;
};

export type HttpVirtualClient2<T> = {
	[K in keyof T as T[K] extends RouteDescriptor ? K : never]: T[K] & {
		can: () => boolean;
	};
};
