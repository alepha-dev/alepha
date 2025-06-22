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

	public readonly cache = $cache<HttpClientCache>();

	protected readonly pendingRequests: HttpClientPendingRequests = {};

	public readonly URL_LINKS = "/api/_links";
	public links?: Array<HttpClientLink>;
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

	public async fetch<T>(
		url: string,
		request: RequestInit = {},
		options: FetchRunOptions = {},
	): Promise<FetchResponse<T>> {
		request.method ??= "GET";

		const cached = await this.cache.get(url);
		if (cached && request.method === "GET") {
			if (cached.etag) {
				request.headers = new Headers(request.headers);
				request.headers.set("if-none-match", cached.etag);
			} else {
				return {
					data: cached.data as T,
					status: 200,
					statusText: "OK",
					headers: new Headers(),
				};
			}
		}

		await this.alepha.emit("client:beforeFetch", {
			url,
			options,
			request,
		});

		// make a key for the request
		// this will be used to check if the request is already pending
		const key =
			options.key ??
			JSON.stringify({
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
				const fetchResponse: FetchResponse = {
					data: await this.responseData(response, options),
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
					raw: response,
				};

				if (request.method === "GET") {
					const etag = response.headers.get("etag") ?? undefined;

					if (options.cache != null || etag) {
						await this.cache.set(
							url,
							{ data: fetchResponse.data, etag },
							typeof options.cache === "boolean" ? undefined : options.cache,
						);
					}
				}

				return fetchResponse;
			})
			.finally(() => {
				delete this.pendingRequests[key];
			});

		this.pendingRequests[key] = pendingRequest;

		return this.pendingRequests[key];
	}

	public async json<T = any>(url: string, options?: RequestInit): Promise<T> {
		const it = await this.fetch<T>(
			url,
			{ method: "GET", ...options },
			{ schema: t.any() },
		);
		return it.data;
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

	protected async responseData(
		response: Response,
		options: FetchRunOptions,
	): Promise<any> {
		if (response.status === 304) {
			const cached = await this.cache.get(response.url);
			if (cached) {
				return cached.data;
			}
		}

		if (response.status === 204) {
			return;
		}

		if (this.isMaybeFile(response)) {
			return this.createFileLike(response);
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

	protected createFileLike(response: Response, defaultFileName = ""): FileLike {
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

	protected queryParams(
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

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Transform a link into a fetch-request then call fetch().
	 */
	public async fetchLink(args: FetchLinkArgs): Promise<FetchResponse> {
		const route = args.link; // our link to fetch
		const options = args.options ?? {}; // fetch standard options, cache, etc.
		const config = args.config ?? {}; // params, query, body, etc.
		const host = args.host ?? ""; // remote host, e.g. "https://api.example.com" or empty (for browser)

		const request: RequestInit = {
			...options.request,
		};

		const method = route.method;
		const headers: Record<string, string> = {};

		const url = this.url(host, route, config);

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
			...options,
		});
	}

	/**
	 * Create a proxy client.
	 * This allows to call actions as methods, e.g. `client.actionName()`.
	 */
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

				$.fetch = async (
					config: any = {},
					options: ClientRequestOptions = {},
				) => {
					const link = await this.getLinkByName(prop, scope);
					return this.followRemote(link, config, options);
				};

				$.can = () => {
					return this.can(prop);
				};

				return $;
			},
		});
	}

	protected async getLinkByName(
		name: string,
		options: ClientScope = {},
	): Promise<HttpClientLink> {
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

		return link;
	}

	/**
	 * Resolve a link by its name and call it.
	 * - If link is local, it will call the local handler.
	 * - If link is remote, it will make a fetch request to the remote server.
	 */
	public async follow(
		name: string,
		config: Partial<ServerRequestConfigEntry> = {},
		options: ClientRequestOptions & ClientScope = {},
	) {
		const link = await this.getLinkByName(name, options);

		const als = this.alepha.context.get<ServerRequest>("request");
		const user = options?.user ?? als?.user;

		// if a handler is defined, use it (ssr)
		if (link.handler && !options.request) {
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

		return this.followRemote(link, config, options).then(
			(response) => response.data,
		);
	}

	protected async followRemote(
		link: HttpClientLink,
		config: Partial<ServerRequestConfigEntry> = {},
		options: ClientRequestOptions = {},
	): Promise<FetchResponse> {
		const als = this.alepha.context.get<ServerRequest>("request");
		if (als?.headers.authorization) {
			options.request ??= {};
			options.request.headers = new Headers(options.request.headers);
			options.request.headers.set("authorization", als.headers.authorization);
		}

		// else, make a request
		return this.fetchLink({
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
			const { data } = await this.fetch<ApiLinksResponse>(
				`${this.URL_LINKS}`,
				{
					method: "GET",
				},
				{
					schema: apiLinksResponseSchema,
				},
			);

			this.links = data.links.map((it) => ({
				...it,
				method: it.method ?? "GET",
			}));
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
	/**
	 * Key to identify the request in the pending requests.
	 */
	key?: string;

	/**
	 * The schema to validate the response against.
	 */
	schema?: TSchema;

	/**
	 * Built-in cache options.
	 */
	cache?: boolean | number | DurationLike;
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

interface HttpClientCache {
	data: any;
	etag?: string;
}

export interface FetchResponse<T = any> {
	data: T;
	status: number;
	statusText: string;
	headers: Headers;
	raw?: Response;
}

export interface FetchLinkArgs {
	link: HttpClientLink;
	host?: string;
	config?: ServerRequestConfigEntry;
	options?: ClientRequestOptions;
}
