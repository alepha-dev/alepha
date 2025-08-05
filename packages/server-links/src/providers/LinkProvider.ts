import { $inject, $logger, Alepha, type Logger, t } from "@alepha/core";
import {
	type ActionDescriptor,
	type ApiLink,
	type ApiLinksResponse,
	apiLinksResponseSchema,
	type ClientRequestEntry,
	type ClientRequestOptions,
	type ClientRequestResponse,
	type FetchResponse,
	HttpClient,
	type RequestConfigSchema,
	type ServerHandler,
	ServerReply,
	type ServerRequest,
	type ServerRequestConfigEntry,
	UnauthorizedError,
} from "@alepha/server";

export class LinkProvider {
	public readonly URL_LINKS = "/api/_links";

	protected readonly log: Logger = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly httpClient: HttpClient = $inject(HttpClient);

	public links?: Array<HttpClientLink>;

	public pushLink(link: HttpClientLink): void {
		if (!this.links) {
			this.links = [];
		}
		if (!link.handler && !link.host && !this.alepha.isBrowser()) {
			throw new Error("Link handler or host is required");
		}

		this.links.push(link);
	}

	public async getLinks(force = false): Promise<HttpClientLink[]> {
		if ((force || !this.links) && this.alepha.isBrowser()) {
			const { data } = await this.httpClient.fetch<ApiLinksResponse>(
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

	public client<T extends object>(
		scope: ClientScope = {},
	): HttpVirtualClient<T> {
		this.log.trace("Creating virtual client with", { scope });

		return new Proxy<HttpVirtualClient<T>>({} as HttpVirtualClient<T>, {
			get: (_, prop) => {
				if (typeof prop !== "string") {
					return;
				}

				return this.createVirtualAction<RequestConfigSchema>(prop, scope);
			},
		});
	}

	protected createVirtualAction<T extends RequestConfigSchema>(
		name: string,
		scope: ClientScope = {},
	): VirtualAction<T> {
		const $: VirtualAction<T> = async (
			config: any = {},
			options: ClientRequestOptions = {},
		) => {
			return this.follow(name, config, {
				...scope,
				...options,
			});
		};

		Object.defineProperty($, "name", {
			value: name,
			writable: false,
		});

		$.run = async (config: any = {}, options: ClientRequestOptions = {}) => {
			return this.follow(name, config, {
				...scope,
				...options,
			});
		};

		$.fetch = async (config: any = {}, options: ClientRequestOptions = {}) => {
			const link = await this.getLinkByName(name, scope);
			return this.followRemote(link, config, options);
		};

		$.can = () => {
			return this.can(name);
		};

		return $;
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
	): Promise<any> {
		this.log.trace("Following link", { name, config, options });
		const link = await this.getLinkByName(name, options);

		const als = this.alepha.context.get<ServerRequest>("request");
		const user = options.user ?? als?.user;

		// if a handler is defined, use it (ssr)
		if (link.handler && !options.request) {
			this.log.trace("Local link found", { name });
			return link.handler({
				method: link.method,
				url: new URL(`http://localhost${link.path}`),
				query: config.query ?? {},
				body: config.body ?? {},
				params: config.params ?? {},
				headers: config.headers ?? {},
				metadata: {},
				raw: {},
				reply: new ServerReply(),
				user,
			} as Partial<ServerRequest> as ServerRequest);
		}

		this.log.trace("Remote link found", {
			name,
			host: link.host,
			service: link.service,
		});

		return this.followRemote(link, config, options).then(
			(response) => response.data,
		);
	}

	protected async followRemote(
		link: HttpClientLink,
		config: Partial<ServerRequestConfigEntry> = {},
		options: ClientRequestOptions = {},
	): Promise<FetchResponse> {
		options.request ??= {};
		options.request.headers = new Headers(options.request.headers);

		const als = this.alepha.context.get<ServerRequest>("request");
		if (als?.headers.authorization) {
			options.request.headers.set("authorization", als.headers.authorization);
		}

		const context = this.alepha.context.get("context");
		if (typeof context === "string") {
			options.request.headers.set("x-request-id", context);
		}

		const action = {
			...link,
			// schema is not used in the client,
			// we assume that typescript will check
			schema: {
				body: t.any(),
				response: t.any(),
			},
		};

		// prefix with service when host is not defined (e.g. browser)
		if (!link.host && link.service) {
			action.path = `/${link.service}${action.path}`;
		}

		action.path = `${action.prefix ?? "/api"}${action.path}`;
		action.prefix = undefined; // prefix is not used in the client

		if (link.requestBodyType) {
			options.request.headers.set("content-type", link.requestBodyType);
		}

		// else, make a request
		return this.httpClient.fetchAction({
			host: link.host,
			config,
			options,
			action,
		});
	}

	public can(name: string): boolean {
		const links = this.alepha.isBrowser()
			? this.links
			: this.alepha.context.get<{ links: HttpClientLink[] }>("links")?.links;

		if (!links) {
			return false;
		}

		return links?.some((link) => link.name === name);
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
			// mimic http error handling
			await this.alepha.emit("client:onError", {
				route: link,
				error,
			});
			throw error;
		}

		return link;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

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
	[K in keyof T as T[K] extends ActionDescriptor<RequestConfigSchema>
		? K
		: never]: T[K] extends ActionDescriptor<infer Schema>
		? VirtualAction<Schema>
		: never;
};

export interface VirtualAction<T extends RequestConfigSchema>
	extends Pick<ActionDescriptor<T>, "name" | "run" | "fetch"> {
	(
		config?: ClientRequestEntry<T>,
		opts?: ClientRequestOptions,
	): Promise<ClientRequestResponse<T>>;
	can: () => boolean;
}
