import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $hook, $inject, $logger, Alepha, type Static, t } from "@alepha/core";
import {
	type ServeDescriptorOptions,
	type ServerHandler,
	ServerLinksProvider,
	ServerRouterProvider,
	ServerStaticProvider,
} from "@alepha/server";
import { type CheerioAPI, load } from "cheerio";
import { renderToString } from "react-dom/server";
import { $page, type PageContext } from "../descriptors/$page.ts";
import {
	ReactRouter,
	type RouterRenderHeadContext,
} from "../services/ReactRouter.ts";
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
	protected readonly router = $inject(ReactRouter);
	protected readonly serverStaticProvider = $inject(ServerStaticProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);
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

			const handler = this.createHandler(() =>
				fetch(templateUrl)
					.then((it) => it.text())
					.catch(() => undefined),
			);

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

			await this.serverStaticProvider.serve(this.createStaticHandler(root));
		}

		const template =
			this.alepha.state("ReactServerProvider.template") ??
			(await readFile(join(root, "index.html"), "utf-8"));

		const handler = this.createHandler(async () => template);

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
			path: this.env.REACT_SERVER_PREFIX,
			cacheControl: true,
			immutable: true,
			maxAge: { days: 30 },
		};
	}

	/**
	 *
	 * @param templateLoader
	 * @protected
	 */
	protected createHandler(
		templateLoader: () => Promise<string | undefined>,
	): ServerHandler {
		return async (ctx) => {
			const { url, cookies, user, reply } = ctx;

			const template = await templateLoader();
			if (!template) {
				throw new Error("Template not found");
			}

			// const response = this.notFoundHandler(ctx.url);
			// if (response) {
			// 	// not found handler for static files (favicon, css, js, etc)
			// 	return response;
			// }

			const hasAuth = this.alepha.has(ReactAuthProvider);

			// if user is not set, we can have non-trusted user from cookie
			if (!ctx.user && ctx.cookies && hasAuth) {
				const auth = this.alepha.get(ReactAuthProvider);
				ctx.user = auth.user.get(ctx.cookies);
				if (ctx.user) {
					ctx.user.roles = []; // user from cookie is not trusted, it's only here for UI
				}
			}

			const args: PageContext = {};

			args.cookies = cookies;
			args.user = user;

			// forward links
			if (this.alepha.has(ServerLinksProvider) && hasAuth) {
				const srv = this.alepha.get(ServerLinksProvider);
				args.links = (await srv.links()) as any;
				this.alepha.als.set("links", args.links);
			}

			const { element, layers, redirect, context } = await this.router.render(
				url.pathname + url.search,
				{
					args,
				},
			);

			if (redirect) {
				return reply.redirect(redirect);
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

			const text = $.html();

			reply.status = 200;
			reply.headers["content-type"] = "text/html";

			return text;
		};
	}

	/**
	 *
	 * @protected
	 */
	protected processDescriptors() {
		const pages = this.alepha.getDescriptorValues($page);
		for (const { key, instance, value } of pages) {
			// =>

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
