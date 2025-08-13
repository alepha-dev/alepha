import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	$env,
	$hook,
	$inject,
	$logger,
	Alepha,
	type Static,
	t,
} from "@alepha/core";
import {
	type ServerHandler,
	ServerRouterProvider,
	ServerTimingProvider,
} from "@alepha/server";
import {
	apiLinksResponseSchema,
	ServerLinksProvider,
} from "@alepha/server-links";
import { ServerStaticProvider } from "@alepha/server-static";
import { renderToString } from "react-dom/server";
import {
	$page,
	type PageDescriptorRenderOptions,
} from "../descriptors/$page.ts";
import { Redirection } from "../errors/Redirection.ts";
import {
	PageDescriptorProvider,
	type PageReactContext,
	type PageRequest,
	type PageRoute,
	type RouterState,
} from "./PageDescriptorProvider.ts";
import type { ReactHydrationState } from "./ReactBrowserProvider.ts";

const envSchema = t.object({
	REACT_SERVER_DIST: t.string({ default: "public" }),
	REACT_SERVER_PREFIX: t.string({ default: "" }),
	REACT_SSR_ENABLED: t.optional(t.boolean()),
	REACT_ROOT_ID: t.string({ default: "root" }),
	REACT_SERVER_TEMPLATE: t.optional(
		t.string({
			size: "rich",
		}),
	),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
	interface State {
		"react.server.ssr"?: boolean;
	}
}

export class ReactServerProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly pageDescriptorProvider = $inject(PageDescriptorProvider);
	protected readonly serverStaticProvider = $inject(ServerStaticProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);
	protected readonly serverTimingProvider = $inject(ServerTimingProvider);
	protected readonly env = $env(envSchema);
	protected readonly ROOT_DIV_REGEX = new RegExp(
		`<div([^>]*)\\s+id=["']${this.env.REACT_ROOT_ID}["']([^>]*)>(.*?)<\\/div>`,
		"is",
	);

	public readonly onConfigure = $hook({
		on: "configure",
		handler: async () => {
			const pages = this.alepha.descriptors($page);

			const ssrEnabled =
				pages.length > 0 && this.env.REACT_SSR_ENABLED !== false;

			this.alepha.state("react.server.ssr", ssrEnabled);

			for (const page of pages) {
				page.render = this.createRenderFunction(page.name);
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
			this.serverRouterProvider.createRoute({
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

					// serve index.html for all unmatched routes
					return this.template;
				},
			});
		},
	});

	public get template() {
		return (
			this.alepha.env.REACT_SERVER_TEMPLATE ??
			"<!DOCTYPE html><html lang='en'><head></head><body></body></html>"
		);
	}

	protected async registerPages(templateLoader: TemplateLoader) {
		for (const page of this.pageDescriptorProvider.getPages()) {
			if (page.children?.length) {
				continue;
			}

			this.log.debug(`+ ${page.match} -> ${page.name}`);

			this.serverRouterProvider.createRoute({
				...page,
				schema: undefined, // schema is handled by the page descriptor provider for now (shared by browser and server)
				method: "GET",
				path: page.match,
				handler: this.createHandler(page, templateLoader),
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
		await this.serverStaticProvider.createStaticServer({
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
	protected createRenderFunction(name: string, withIndex = false) {
		return async (options: PageDescriptorRenderOptions = {}) => {
			const page = this.pageDescriptorProvider.page(name);
			const url = new URL(this.pageDescriptorProvider.url(name, options));
			const context: PageRequest = {
				url,
				params: options.params ?? {},
				query: options.query ?? {},
				head: {},
				onError: () => null,
			};

			await this.alepha.emit("react:server:render:begin", {
				context,
			});

			const state = await this.pageDescriptorProvider.createLayers(
				page,
				context,
			);

			if (!withIndex && !options.html) {
				return {
					context,
					html: renderToString(
						this.pageDescriptorProvider.root(state, context),
					),
				};
			}

			const html = this.renderToHtml(
				this.template ?? "",
				state,
				context,
				options.hydration,
			);

			if (html instanceof Redirection) {
				throw new Error("Redirection is not supported in this context");
			}

			const result = {
				context,
				state,
				html,
			};

			await this.alepha.emit("react:server:render:end", result);

			return result;
		};
	}

	protected createHandler(
		page: PageRoute,
		templateLoader: TemplateLoader,
	): ServerHandler {
		return async (serverRequest) => {
			const { url, reply, query, params } = serverRequest;
			const template = await templateLoader();
			if (!template) {
				throw new Error("Template not found");
			}

			this.log.trace("Rendering page", {
				name: page.name,
			});

			const context: PageRequest = {
				url,
				params,
				query,
				// plugins
				head: {},
				onError: () => null,
			};

			if (this.alepha.has(ServerLinksProvider)) {
				this.alepha.state(
					"api",
					await this.alepha.inject(ServerLinksProvider).getUserApiLinks({
						user: serverRequest.user,
						authorization: serverRequest.headers.authorization,
					}),
				);
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

			// TODO: SSR strategies
			// - only when googlebot
			// - only child pages
			// if (page.client) {
			// 	// if the page is a client-only page, return 404
			// 	reply.status = 200;
			// 	reply.headers["content-type"] = "text/html";
			// 	reply.body = template;
			// 	return;
			// }

			await this.alepha.emit("react:server:render:begin", {
				request: serverRequest,
				context,
			});

			this.serverTimingProvider.beginTiming("createLayers");

			const state = await this.pageDescriptorProvider.createLayers(
				page,
				context,
			);

			this.serverTimingProvider.endTiming("createLayers");

			if (state.redirect) {
				return reply.redirect(state.redirect);
			}

			reply.headers["content-type"] = "text/html";

			// by default, disable caching for SSR responses
			// some plugins may override this
			reply.headers["cache-control"] =
				"no-store, no-cache, must-revalidate, proxy-revalidate";
			reply.headers.pragma = "no-cache";
			reply.headers.expires = "0";

			const html = this.renderToHtml(template, state, context);
			if (html instanceof Redirection) {
				reply.redirect(
					typeof html.page === "string"
						? html.page
						: this.pageDescriptorProvider.href(html.page),
				);
				return;
			}

			const event = {
				request: serverRequest,
				context,
				state,
				html,
			};

			await this.alepha.emit("react:server:render:end", event);

			page.onServerResponse?.(serverRequest);

			this.log.trace("Page rendered", {
				name: page.name,
			});

			return event.html;
		};
	}

	public renderToHtml(
		template: string,
		state: RouterState,
		context: PageReactContext,
		hydration = true,
	): string | Redirection {
		const element = this.pageDescriptorProvider.root(state, context);

		this.serverTimingProvider.beginTiming("renderToString");

		let app = "";
		try {
			app = renderToString(element);
		} catch (error) {
			this.log.error("Error during SSR", error);
			const element = context.onError(error as Error, context);
			if (element instanceof Redirection) {
				// if the error is a redirection, return the redirection URL
				return element;
			}

			app = renderToString(element);
		}

		this.serverTimingProvider.endTiming("renderToString");

		const response = {
			html: template,
		};

		if (hydration) {
			const { request, context, ...rest } =
				this.alepha.context.als?.getStore() ?? {};

			const hydrationData: ReactHydrationState = {
				...rest,
				layers: state.layers.map((it) => ({
					...it,
					error: it.error
						? {
								...it.error,
								name: it.error.name,
								message: it.error.message,
								stack: !this.alepha.isProduction() ? it.error.stack : undefined,
							}
						: undefined,
					index: undefined,
					path: undefined,
					element: undefined,
					route: undefined,
				})),
			};

			// create hydration data
			const script = `<script>window.__ssr=${JSON.stringify(hydrationData)}</script>`;

			// inject app into template
			this.fillTemplate(response, app, script);
		}

		return response.html;
	}

	protected fillTemplate(
		response: { html: string },
		app: string,
		script: string,
	) {
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
					return `${match}<div id="${this.env.REACT_ROOT_ID}">${app}</div>`;
				});
			}
		}

		const bodyCloseTagRegex = /<\/body>/i;
		if (bodyCloseTagRegex.test(response.html)) {
			response.html = response.html.replace(
				bodyCloseTagRegex,
				`${script}</body>`,
			);
		}
	}
}

type TemplateLoader = () => Promise<string | undefined>;
