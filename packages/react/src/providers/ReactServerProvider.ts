import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	$hook,
	$inject,
	$logger,
	Alepha,
	OPTIONS,
	type Static,
	t,
} from "@alepha/core";
import {
	type ServerHandler,
	ServerLinksProvider,
	ServerRouterProvider,
	apiLinksResponseSchema,
} from "@alepha/server";
import { ServerStaticProvider } from "@alepha/server-static";
import { renderToString } from "react-dom/server";
import { $page } from "../descriptors/$page.ts";
import {
	PageDescriptorProvider,
	type PageRequest,
	type PageRoute,
} from "./PageDescriptorProvider.ts";
import type { ReactHydrationState } from "./ReactBrowserProvider.ts";
import { ServerHeadProvider } from "./ServerHeadProvider.ts";

export const envSchema = t.object({
	REACT_SERVER_DIST: t.string({ default: "public" }),
	REACT_SERVER_PREFIX: t.string({ default: "" }),
	REACT_SSR_ENABLED: t.optional(t.boolean()),
	REACT_ROOT_ID: t.string({ default: "root" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
	interface State {
		"ReactServerProvider.template"?: string;
		"ReactServerProvider.ssr"?: boolean;
	}
}

export class ReactServerProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly pageDescriptorProvider = $inject(PageDescriptorProvider);
	protected readonly serverStaticProvider = $inject(ServerStaticProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);
	protected readonly headProvider = $inject(ServerHeadProvider);
	protected readonly env = $inject(envSchema);
	protected readonly ROOT_DIV_REGEX = new RegExp(
		`<div([^>]*)\\s+id=["']${this.env.REACT_ROOT_ID}["']([^>]*)>(.*?)<\\/div>`,
		"is",
	);

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const pages = this.alepha.getDescriptorValues($page);

			const ssrEnabled =
				pages.length > 0 && this.env.REACT_SSR_ENABLED !== false;

			this.alepha.state("ReactServerProvider.ssr", ssrEnabled);

			for (const { key, instance, value } of pages) {
				const name = value[OPTIONS].name ?? key;

				if (this.alepha.isTest()) {
					instance[key].render = this.createRenderFunction(name);
				}
			}

			// development mode
			if (this.alepha.isServerless() === "vite") {
				await this.configureVite(ssrEnabled);
				return;
			}

			// production mode
			let root = "";

			// non-serverless mode only -> serve static files
			if (!this.alepha.isServerless()) {
				root = this.getPublicDirectory();
				if (!root) {
					this.log.warn(
						"Missing static files, static file server will be disabled",
					);
				} else {
					this.log.debug(`Using static files from: ${root}`);
					await this.configureStaticServer(root);
				}
			}

			if (ssrEnabled) {
				await this.registerPages(async () => this.template);
				this.log.info("SSR OK");
				return;
			}

			// no SSR enabled, serve index.html for all unmatched routes
			this.log.info("SSR is disabled, use History API fallback");
			await this.serverRouterProvider.route({
				path: "*",
				handler: async ({ url, reply }) => {
					if (url.pathname.includes(".")) {
						// If the request is for a file (e.g., /style.css), do not fallback
						reply.headers["content-type"] = "text/plain";
						reply.body = "Not Found";
						reply.status = 404;
						return;
					}

					reply.headers["content-type"] = "text/html";
					reply.status = 200;

					// serve index.html for all unmatched routes
					return this.template;
				},
			});
		},
	});

	public get template() {
		return this.alepha.state("ReactServerProvider.template");
	}

	protected async registerPages(
		templateLoader: () => Promise<string | undefined>,
	) {
		for (const page of this.pageDescriptorProvider.getPages()) {
			this.log.debug(`+ ${page.match} -> ${page.name}`);

			await this.serverRouterProvider.route({
				method: "GET",
				path: page.match,
				handler: this.createSsrHandler(page, templateLoader),
			});
		}
	}

	protected getPublicDirectory(): string {
		const maybe = [
			join(process.cwd(), `dist/${this.env.REACT_SERVER_DIST}`),
			join(process.cwd(), this.env.REACT_SERVER_DIST),
		];

		for (const it of maybe) {
			if (existsSync(it)) {
				return it;
			}
		}

		return "";
	}

	protected async configureStaticServer(root: string) {
		await this.serverStaticProvider.serve({
			root,
			path: this.env.REACT_SERVER_PREFIX,
		});
	}

	protected async configureVite(ssrEnabled: boolean) {
		if (!ssrEnabled) {
			// do nothing, vite will handle everything for us
			return;
		}

		this.log.info("SSR (vite) OK");

		const url = `http://${process.env.SERVER_HOST}:${process.env.SERVER_PORT}`;

		await this.registerPages(() =>
			fetch(`${url}/index.html`)
				.then((it) => it.text())
				.catch(() => undefined),
		);
	}

	/**
	 * For testing purposes, creates a render function that can be used.
	 */
	protected createRenderFunction(name: string) {
		return async (
			options: {
				params?: Record<string, string>;
				query?: Record<string, string>;
			} = {},
		) => {
			const page = this.pageDescriptorProvider.page(name);
			const context: PageRequest = {
				url: new URL("http://localhost"),
				params: options.params ?? {},
				query: options.query ?? {},
				head: {},
				onError: () => null,
			};

			// for testing
			const state = await this.pageDescriptorProvider.createLayers(
				page,
				context,
			);

			return renderToString(this.pageDescriptorProvider.root(state, context));
		};
	}

	protected createSsrHandler(
		page: PageRoute,
		templateLoader: () => Promise<string | undefined>,
	): ServerHandler {
		return async (serverRequest) => {
			const { url, reply, query, params } = serverRequest;
			const template = await templateLoader();
			if (!template) {
				throw new Error("Template not found");
			}

			const context: PageRequest = {
				url,
				params,
				query,
				// plugins
				head: {},
				onError: () => null,
			};

			if (this.alepha.has(ServerLinksProvider)) {
				const srv = this.alepha.get(ServerLinksProvider);
				const schema = apiLinksResponseSchema as any;

				context.links = this.alepha.parse(
					schema,
					await srv.getLinks({
						user: serverRequest.user,
						authorization: serverRequest.headers.authorization,
					}),
				) as any;

				this.alepha.context.set("links", context.links);
			}

			let target: PageRoute | undefined = page; // TODO: move to PageDescriptorProvider
			while (target) {
				if (page.can && !page.can()) {
					// if the page is not accessible, return 403
					reply.status = 403;
					reply.headers["content-type"] = "text/plain";
					return "Forbidden";
				}
				target = target.parent;
			}

			await this.alepha.emit(
				"react:server:render",
				{
					request: serverRequest,
					pageRequest: context,
				},
				{
					log: false,
				},
			);

			const state = await this.pageDescriptorProvider.createLayers(
				page,
				context,
			);

			if (state.redirect) {
				return reply.redirect(state.redirect);
			}

			const element = this.pageDescriptorProvider.root(state, context);
			const app = renderToString(element);

			const hydrationData: ReactHydrationState = {
				links: context.links,
				layers: state.layers.map((it) => ({
					...it,
					error: it.error
						? {
								...it.error,
								name: it.error.name,
								message: it.error.message,
								stack: it.error.stack, // TODO: Hide stack in production ?
							}
						: undefined,
					index: undefined,
					path: undefined,
					element: undefined,
				})),
			};

			// create hydration data
			const script = `<script>window.__ssr=${JSON.stringify(hydrationData)}</script>`;

			const response = {
				html: template,
			};

			reply.status = 200;
			reply.headers["content-type"] = "text/html";
			reply.headers["cache-control"] =
				"no-store, no-cache, must-revalidate, proxy-revalidate";
			reply.headers.pragma = "no-cache";
			reply.headers.expires = "0";

			// inject app into template
			this.fillTemplate(response, app, script);

			// inject head meta
			if (context.head) {
				response.html = this.headProvider.renderHead(
					response.html,
					context.head,
				);
			}

			// TODO: hook for plugins "react:server:template"
			// { response: { html: string }, request, state }

			return response.html;
		};
	}

	fillTemplate(response: { html: string }, app: string, script: string) {
		if (this.ROOT_DIV_REGEX.test(response.html)) {
			// replace contents of the existing <div id="root">
			response.html = response.html.replace(
				this.ROOT_DIV_REGEX,
				(_match, beforeId, afterId) => {
					return `<div${beforeId} id="${this.env.REACT_ROOT_ID}"${afterId}>${app}</div>`;
				},
			);
		} else {
			const bodyOpenTag = /<body([^>]*)>/i;
			if (bodyOpenTag.test(response.html)) {
				response.html = response.html.replace(bodyOpenTag, (match) => {
					return `${match}\n<div id="${this.env.REACT_ROOT_ID}">${app}</div>`;
				});
			}
		}

		const bodyCloseTagRegex = /<\/body>/i;
		if (bodyCloseTagRegex.test(response.html)) {
			response.html = response.html.replace(
				bodyCloseTagRegex,
				`${script}\n</body>`,
			);
		}
	}
}
