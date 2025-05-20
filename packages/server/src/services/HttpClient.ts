import { $cache } from "@alepha/cache";
import type { TObject } from "@alepha/core";
import {
	$inject,
	Alepha,
	type FileLike,
	isFileLike,
	isTypeFile,
	t,
	type TSchema,
} from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
	ClientRequestEntry,
	ClientRequestOptions,
	RouteDescriptor,
} from "../descriptors/$action.ts";
import { HttpError } from "../errors/HttpError.ts";
import { UnauthorizedError } from "../errors/UnauthorizedError.ts";
import { RouteDescriptorHelper } from "../helpers/RouteDescriptorHelper.ts";
import type {
	RequestConfigSchema,
	ServerHandler,
	ServerRequest,
	ServerRequestConfigEntry,
} from "../providers/ServerRouterProvider.ts";
import { errorSchema } from "../schemas/errorSchema.ts";

const envSchema = t.object({
	SERVER_API_URL: t.string({
		default: "/api",
	}),
	CLIENT_API_PREFIX: t.string({
		default: "",
	}),
});

export class HttpClient {
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);
	protected readonly helper = $inject(RouteDescriptorHelper);

	public readonly URL_LINKS = "/_links";
	public readonly cache = $cache<any>();
	public links?: Array<HttpClientLink>;

	protected readonly pendingRequests: HttpClientPendingRequests = {};

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
			request: ClientRequestOptions = {},
		) => {
			const host =
				typeof options?.host === "function" ? options.host() : options?.host;

			return this.request({
				config,
				request,
				link,
				host,
			});
		};
	}

	public async request(args: {
		config?: ServerRequestConfigEntry;
		link: HttpClientLink;
		request?: ClientRequestOptions;
		host?: string;
	}) {
		const route = args.link;
		const options = args.request ?? {};
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

		await this.alepha.emit("client:onRequest", {
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
			...Object.fromEntries(new Headers(request.headers).entries()),
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
		let url = host + this.env.CLIENT_API_PREFIX + link.path;

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

		if (
			link.contentType === "multipart/form-data" ||
			hasHeader ||
			this.helper.isMultipart(link)
		) {
			if (typeof init.headers === "object" && "content-type" in init.headers) {
				delete init.headers["content-type"]; // fetch() will fill this for us
			}

			const formData = new FormData();

			for (const [key, value] of Object.entries(args.body ?? {})) {
				if (typeof value === "string") {
					formData.append(key, value);
					continue;
				}
				if (value instanceof Blob) {
					formData.append(key, value);
					continue;
				}
				if (isFileLike(value)) {
					// FileLike must be transformed to WebFile
					formData.append(
						key,
						new File([await value.arrayBuffer()], value.name, {
							type: value.type,
						}),
					);
				}
			}

			init.body = formData;

			return;
		}

		if (!init.body && link.schema?.body) {
			headers["content-type"] = "application/json";
			init.body = JSON.stringify(
				this.alepha.parse(link.schema?.body, args.body),
			);
		}
	}

	public async fetch<T>(
		url: string,
		request: RequestInit,
		options: FetchRunOptions = {},
	): Promise<T> {
		await this.alepha.emit("client:beforeFetch", {
			url,
			options,
			request,
		});

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

			if (isTypeFile(options.schema) || this.isMaybeFile(response)) {
				return this.getFileLike(response);
			}

			const text = await response.text();

			if (response.headers.get("Content-Type") !== "application/json") {
				return text;
			}

			const json = JSON.parse(text);

			if (response.status >= 400) {
				const jsonError = this.alepha.parse(errorSchema, json);
				const error = new HttpError(jsonError);

				await this.alepha.emit("client:onError", {
					error,
				});

				throw error;
			}

			return this.alepha.parse(options.schema, json);
		}

		return response;
	}

	protected isMaybeFile(response: Response): boolean {
		const contentType = response.headers.get("Content-Type");
		if (!contentType) {
			return false;
		}

		return (
			contentType.startsWith("application/octet-stream") ||
			contentType.startsWith("application/pdf") ||
			contentType.startsWith("image/") ||
			contentType.startsWith("video/") ||
			contentType.startsWith("audio/")
		);
	}

	protected getFileLike(response: Response, defaultFileName = ""): FileLike {
		const match = (response.headers.get("Content-Disposition") ?? "").match(
			/filename="(.+)"/,
		);
		return {
			name: match?.[1] ? match[1] : defaultFileName,
			type: response.headers.get("Content-Type") ?? "application/octet-stream",
			size: Number(response.headers.get("Content-Length") ?? 0),
			lastModified: Date.now(),
			stream: () => {
				throw new Error("Not implemented");
			},
			arrayBuffer: async () => {
				return await response.arrayBuffer();
			},
			text: async () => {
				return await response.text();
			},
		};
	}

	protected pathVariables(
		url: string,
		action: HttpClientLink,
		args: ServerRequestConfigEntry = {},
	): string {
		if (typeof args.params === "object") {
			const params = action.schema?.params
				? (this.alepha.parse(action.schema.params, args.params) as Record<
						string,
						any
					>)
				: args.params;

			for (const key of Object.keys(params)) {
				url = url.replace(`:${key}`, params[key]);
				url = url.replace(`{${key}}`, params[key]);
			}
		}

		return url;
	}

	public queryParams(
		url: string,
		action: { schema?: { query?: TObject } },
		args: ServerRequestConfigEntry = {},
	): string {
		if (typeof args.query === "object") {
			const query = action.schema?.query
				? this.alepha.parse(action.schema.query, args.query ?? {})
				: args.query;

			for (const key of Object.keys(query)) {
				if (query[key] === undefined) {
					delete query[key];
				}
			}

			return `${url}?${new URLSearchParams(
				query as Record<string, string>,
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

				const $ = async (
					config: any = {},
					request: ClientRequestOptions = {},
				) => {
					return this.follow(prop, config, {
						...options,
						request,
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

	public async follow(
		name: string,
		config: any = {},
		options: {
			request?: ClientRequestOptions;
			group?: string;
			host?: string | (() => string);
		} = {},
	) {
		const request = options.request ?? {};
		const host: string | undefined =
			typeof options.host === "function" ? options.host() : options.host;

		const links = await this.getLinks({
			host,
		});

		const link = links.find((a) => a.name === name);

		if (!link) {
			const error = new UnauthorizedError(`Action ${name} not found.`);

			await this.alepha.emit("client:onError", {
				route: link,
				error,
			});

			throw error;
		}

		// if a handler is defined, use it (ssr)
		if (link.handler) {
			const request = {
				method: link.method,
				url: new URL(`http://localhost${link.path}`),
				query: config.query ?? {},
				body: config.body ?? {},
				params: config.params ?? {},
				headers: config.headers ?? {},
				metadata: {},
				raw: {},
				reply: {
					headers: {},
					redirect: () => {},
				},
			} as Partial<ServerRequest>;

			return link.handler(request as ServerRequest);
		}

		// else, make a request
		return this.request({
			host: link.host ?? host,
			config,
			request,
			link: {
				...link,
				// schema is not used in the client, just mock it
				schema: {
					body: t.any(),
					response: t.any(),
				},
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
		if (opts.host && (!this.links || opts.force)) {
			this.links = await this.json<any[]>(
				`${opts.host}${this.env.SERVER_API_URL}${this.URL_LINKS}`,
			);
		}

		return this.links ?? [];
	}
}

// ---------------------------------------------------------------------------------------------------------------------

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
	host?: string;
	proxy?: boolean;
}

export type HttpVirtualClient<T> = {
	[K in keyof T as T[K] extends RouteDescriptor ? K : never]: T[K] & {
		can: () => boolean;
	};
};
