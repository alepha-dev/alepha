import { $cache } from "@alepha/cache";
import {
	$inject,
	$logger,
	Alepha,
	type FileLike,
	isFileLike,
	type TObject,
	type TSchema,
	t,
} from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";
import type {
	ActionDescriptor,
	ClientRequestEntry,
	ClientRequestOptions,
} from "../descriptors/$action.ts";
import { HttpError } from "../errors/HttpError.ts";
import { UnauthorizedError } from "../errors/UnauthorizedError.ts";
import { ActionDescriptorHelper } from "../helpers/ActionDescriptorHelper.ts";
import type {
	RequestConfigSchema,
	ServerHandler,
	ServerRequest,
	ServerRequestConfigEntry,
} from "../providers/ServerRouterProvider.ts";
import {
	type ApiLink,
	type ApiLinksResponse,
	apiLinksResponseSchema,
} from "../schemas/apiLinksResponseSchema.ts";
import { errorSchema } from "../schemas/errorSchema.ts";

export class HttpClient {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly helper = $inject(ActionDescriptorHelper);

	public readonly URL_LINKS = "/api/_links";
	public readonly cache = $cache<any>();
	public links?: Array<HttpClientLink>;

	protected readonly pendingRequests: HttpClientPendingRequests = {};

	public pushLink(link: HttpClientLink) {
		if (!this.links) {
			this.links = [];
		}
		if (!link.handler && !link.host && !this.alepha.isBrowser()) {
			throw new Error("Link handler or host is required");
		}

		this.links.push(link);
	}

	public async clear() {
		await this.cache.invalidate();
	}

	public createFetchFunction(
		link: HttpClientLink,
		args?: FetchFactoryAdditionalOptions,
	) {
		return (
			config: Partial<ClientRequestEntry> = {},
			options: ClientRequestOptions = {},
		) => {
			const host = typeof args?.host === "function" ? args.host() : args?.host;
			return this.request({
				config,
				options,
				link,
				host,
			});
		};
	}

	public async request(args: {
		link: HttpClientLink;
		host?: string;
		config?: ServerRequestConfigEntry;
		options?: ClientRequestOptions;
	}) {
		const route = args.link;
		const options = args.options ?? {};
		const config = args.config ?? {};
		const host = args.host ?? "";

		const request: RequestInit = {
			...options.request,
		};

		const method = route.method;
		const headers: Record<string, string> = {};

		const url = this.url(host, route, config);

		const data = await this.cache.get(url);
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

		return await this.fetch(url, request, {
			schema: route.schema?.response,
		});
	}

	protected url(
		host: string,
		link: HttpClientLink,
		args: ServerRequestConfigEntry,
	) {
		let url = host;

		url += link.prefix ?? "/api";

		// prefix with service when host is not defined (e.g. browser)
		if (!link.host) {
			url += link.service ? `/${link.service}` : "";
		}

		url += link.path;

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
			link.requestBodyType === "multipart/form-data" ||
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
		request: RequestInit = {},
		options: FetchRunOptions = {},
	): Promise<T> {
		request.method ??= "GET";

		const data = await this.cache.get(url);
		if (data && request.method === "GET") {
			return data;
		}

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
			.then(async (response) => {
				const data = await this.response(response, options);

				if (options.cache !== undefined && request.method === "GET") {
					await this.cache.set(
						url,
						data,
						typeof options.cache === "boolean" ? undefined : options.cache,
					);
				}

				return data;
			})
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
		if (response.status === 204) {
			return;
		}

		if (this.isMaybeFile(response)) {
			return this.getFileLike(response);
		}

		if (response.headers.get("Content-Type") === "text/plain") {
			return await response.text();
		}

		if (response.headers.get("Content-Type") === "application/json") {
			const json = await response.json();

			if (response.status >= 400) {
				const jsonError = this.alepha.parse(errorSchema, json);
				const error = new HttpError(jsonError);

				await this.alepha.emit("client:onError", {
					error,
				});

				throw error;
			}

			if (options.schema) {
				return this.alepha.parse(options.schema, json);
			}

			return json;
		}

		if (response.status >= 400) {
			const error = new HttpError({
				status: response.status,
				message: `An error occurred while fetching the resource. (${response.statusText})`,
			});

			await this.alepha.emit("client:onError", {
				error,
			});

			throw error;
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

	public of<T extends object>(scope: ClientScope = {}): HttpVirtualClient<T> {
		return new Proxy<HttpVirtualClient<T>>({} as HttpVirtualClient<T>, {
			get: (_, prop) => {
				if (typeof prop !== "string") {
					return;
				}

				const $ = async (
					config: any = {},
					options: ClientRequestOptions = {},
				) => {
					return this.follow(prop, config, {
						...scope,
						...options,
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
		config: Partial<ServerRequestConfigEntry> = {},
		options: ClientRequestOptions & ClientScope = {},
	) {
		const als = this.alepha.context.get<ServerRequest>("request");
		const user = options?.user ?? als?.user;

		const links = await this.getLinks();
		const link = links.find(
			(a) =>
				a.name === name &&
				(!options.group || a.group === options.group) &&
				(!options.service || options.service === a.service),
		);

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
			return link.handler({
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
				user,
			} as Partial<ServerRequest> as ServerRequest);
		}

		if (als?.headers.authorization) {
			options.request ??= {};
			options.request.headers = new Headers(options.request.headers);
			options.request.headers.set("authorization", als.headers.authorization);
		}

		// else, make a request
		return this.request({
			host: link.host,
			config,
			options,
			link: {
				...link,
				// schema is not used in the client,
				// we assume that typescript will check
				schema: {
					body: t.any(),
					response: t.any(),
				},
			},
		});
	}

	public can(name: string): boolean {
		const links = this.alepha.isBrowser()
			? this.links
			: this.alepha.context.get<{ links: HttpClientLink[] }>("links")?.links;

		if (!links) {
			return false;
		}

		return !!links?.some((link) => link.name === name);
	}

	public async getLinks(force = false): Promise<HttpClientLink[]> {
		if ((force || !this.links) && this.alepha.isBrowser()) {
			const { links } = await this.fetch<ApiLinksResponse>(
				`${this.URL_LINKS}`,
				{
					method: "GET",
				},
				{
					schema: apiLinksResponseSchema,
				},
			);

			this.links = links.map((it) => ({
				...it,
				method: it.method ?? "GET",
			}));
		}

		return this.links ?? [];
	}

	public json<T = any>(url: string, options?: RequestInit): Promise<T> {
		return this.fetch(url, { method: "GET", ...options }, { schema: t.any() });
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

export interface HttpClientLink extends ApiLink {
	secured?: boolean;
	prefix?: string;
	// -- server only --
	// only for remote actions
	host?: string;
	service?: string;
	// used only for local actions, not for remote actions
	schema?: RequestConfigSchema;
	handler?: ServerHandler;
}

export interface ClientScope {
	group?: string;
	service?: string;
}

export type HttpVirtualClient<T> = {
	[K in keyof T as T[K] extends ActionDescriptor
		? K
		: never]: T[K] extends ActionDescriptor<infer Schema>
		? T[K] & {
				can: () => boolean;
				schema: Schema;
			}
		: never;
};
