import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $logger, Alepha, type Static } from "@alepha/core";
import { $hook, $inject, t } from "@alepha/core";
import {
	type HttpLink,
	type ServeDescriptorOptions,
	ServerLinksProvider,
	ServerProvider,
} from "@alepha/server";
import type { RouteObject } from "@alepha/server";
import { type CheerioAPI, load } from "cheerio";
import { renderToString } from "react-dom/server";
import { $page, type PageContext } from "../descriptors/$page";
import { Router, type RouterRenderHeadContext } from "../services/Router";
import { ReactAuthProvider } from "./ReactAuthProvider.ts";

export const envSchema = t.object({
	REACT_SERVER_DIST: t.string({ default: "client" }),
	REACT_SERVER_PREFIX: t.string({ default: "" }),
	REACT_SSR_ENABLED: t.boolean({ default: false }),
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
	protected readonly router = $inject(Router);
	protected readonly serverProvider = $inject(ServerProvider);
	protected readonly env = $inject(envSchema);

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			await this.configureRoutes();
		},
	});

	id = Math.random().toString(36).substring(2, 7);

	protected async configureRoutes() {
		this.alepha.state("ReactServerProvider.ssr", false);

		if (this.alepha.isTest()) {
			this.processDescriptors();
		}

		if (this.router.empty()) {
			return;
		}

		if (process.env.VITE_ALEPHA_DEV === "true") {
			const url = `http://${process.env.SERVER_HOST}:${process.env.SERVER_PORT}`;
			this.log.info("SSR (vite) OK");
			this.alepha.state("ReactServerProvider.ssr", true);
			const templateUrl = `${url}/index.html`;

			const route = this.createHandler(() =>
				fetch(templateUrl)
					.then((it) => it.text())
					.catch(() => undefined),
			);

			await this.serverProvider.route(route);

			// fallback for static files
			await this.serverProvider.route({
				...route,
				url: "*",
			});

			return;
		}

		let root = "";

		if (!this.alepha.isServerless()) {
			const maybe = [
				join(process.cwd(), this.env.REACT_SERVER_DIST),
				join(process.cwd(), "..", this.env.REACT_SERVER_DIST),
			];

			for (const it of maybe) {
				if (existsSync(it)) {
					root = it;
					break;
				}
			}

			if (!root) {
				this.log.warn("Missing static files, SSR will be disabled");
				return;
			}

			await this.serverProvider.serve(this.createStaticHandler(root));
		}

		const template =
			this.alepha.state("ReactServerProvider.template") ??
			(await readFile(join(root, "index.html"), "utf-8"));

		const route = this.createHandler(async () => template);

		await this.serverProvider.route(route); // we must take control of "/", or it will be handled by the static handler

		// fallback for static files
		await this.serverProvider.route({
			...route,
			url: "*",
		});

		this.alepha.state("ReactServerProvider.ssr", true);
	}

	/**
	 *
	 * @param root
	 * @protected
	 */
	protected createStaticHandler(root: string): ServeDescriptorOptions {
		return {
			root,
			prefix: this.env.REACT_SERVER_PREFIX,
			logLevel: "warn",
			cacheControl: true,
			immutable: true,
			preCompressed: true,
			maxAge: "30d",
			index: false,
		};
	}

	/**
	 *
	 * @param templateLoader
	 * @protected
	 */
	protected createHandler(
		templateLoader: () => Promise<string | undefined>,
	): RouteObject {
		return {
			method: "GET",
			url: "/",
			handler: async (ctx) => {
				const template = await templateLoader();
				if (!template) {
					return new Response("Not found", { status: 404 });
				}

				const response = this.notFoundHandler(ctx.url);
				if (response) {
					// not found handler for static files (favicon, css, js, etc)
					return response;
				}

				return await this.ssr(ctx.url, template, ctx);
			},
		};
	}

	/**
	 *
	 * @protected
	 */
	protected processDescriptors() {
		const pages = this.alepha.getDescriptorValues($page);
		for (const { key, instance, value } of pages) {
			instance[key].render = async (
				options: {
					params?: Record<string, string>;
					query?: Record<string, string>;
				} = {},
			) => {
				const name = value.options.name ?? key;
				const page = this.router.page(name);
				const layers = await this.router.createLayers(
					"",
					page,
					options.params ?? {},
					options.query ?? {},
					[],
				);

				return renderToString(
					this.router.root({
						layers,
						pathname: "",
						search: "",
						context: {},
					}),
				);
			};
		}
	}

	/**
	 *
	 * @param url
	 * @protected
	 */
	protected notFoundHandler(url: URL) {
		if (url.pathname.match(/\.\w+$/)) {
			return new Response("Not found", { status: 404 });
		}
	}

	/**
	 *
	 * @param url
	 * @param template
	 * @param args
	 */
	public async ssr(
		url: URL,
		template: string,
		args: PageContext = {},
	): Promise<Response> {
		const hasAuth = this.alepha.has(ReactAuthProvider);

		// if user is not set, we can have non-trusted user from cookie
		if (!args.user && args.cookies && hasAuth) {
			const auth = this.alepha.get(ReactAuthProvider);
			args.user = auth.user.get(args.cookies);
			if (args.user) {
				args.user.roles = []; // user from cookie is not trusted, it's only here for UI
			}
		}

		if (this.alepha.has(ServerLinksProvider) && hasAuth) {
			args.links = (await this.alepha
				.get(ServerLinksProvider)
				.links()) as HttpLink[];
			this.alepha.als.set("links", args.links);
		}

		const { element, layers, redirect, context } = await this.router.render(
			url.pathname + url.search,
			{
				args,
			},
		);

		if (redirect) {
			return new Response("", {
				status: 302,
				headers: {
					Location: redirect,
				},
			});
		}

		const html = renderToString(element);
		const $ = load(template);

		const script = `<script>window.__ssr=${JSON.stringify({
			links: args.links,
			layers: layers.map((it) => ({
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
		})}</script>`;

		const body = $("body");
		const root = body.find(`#${this.env.REACT_ROOT_ID}`);
		if (root.length) {
			root.html(html);
		} else {
			body.prepend(`<div id="${this.env.REACT_ROOT_ID}">${html}</div>`);
		}

		body.append(script);

		if (context.head) {
			this.renderHeadContext($, context.head);
		}

		return new Response($.html(), {
			headers: { "Content-Type": "text/html" },
		});
	}

	protected renderHeadContext(
		$: CheerioAPI,
		headContext: RouterRenderHeadContext,
	) {
		const head = $("head");
		if (head) {
			if (headContext.title) {
				head.find("title").remove();
				head.append(`<title>${headContext.title}</title>`);
			}
			if (headContext.meta) {
				for (const it of headContext.meta) {
					const meta = head.find(`meta[name="${it.name}"]`);
					if (meta.length) {
						meta.attr("content", it.content);
					} else {
						head.append(`<meta name="${it.name}" content="${it.content}" />`);
					}
				}
			}
		}

		if (headContext.htmlAttributes) {
			for (const [key, value] of Object.entries(headContext.htmlAttributes)) {
				$("html").attr(key, value);
			}
		}

		if (headContext.bodyAttributes) {
			for (const [key, value] of Object.entries(headContext.bodyAttributes)) {
				$("body").attr(key, value);
			}
		}
	}
}
