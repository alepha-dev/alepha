import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $hook, $inject, $logger, Alepha, type Static, t } from "@alepha/core";
import {
	type ServerHandler,
	ServerLinksProvider,
	type ServerRoute,
	ServerRouterProvider,
	ServerStaticProvider,
} from "@alepha/server";
import { type CheerioAPI, load } from "cheerio";
import { renderToString } from "react-dom/server";
import { $page, type Head } from "../descriptors/$page.ts";
import {
	PageDescriptorProvider,
	type PageRequest,
	type PageRoute,
} from "./PageDescriptorProvider.ts";
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
	protected readonly pageDescriptorProvider = $inject(PageDescriptorProvider);
	protected readonly serverStaticProvider = $inject(ServerStaticProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);
	protected readonly env = $inject(envSchema);

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const routes: ServerRoute[] = [];
			const pages = this.alepha.getDescriptorValues($page);
			if (pages.length === 0) {
				return;
			}

			for (const { key, instance, value } of pages) {
				const name = value.options.name ?? key;
				const page = value.options;

				if (this.alepha.isTest()) {
					instance[key].render = this.createRenderFunction(name);
				}
			}

			if (process.env.VITE_ALEPHA_DEV === "true") {
				this.configureVite();
				return;
			}

			let root = "";
			if (!this.alepha.isServerless()) {
				root = this.getPublicDirectory();

				if (!root) {
					this.log.warn("Missing static files, SSR will be disabled");
					return;
				}

				await this.configureStaticServer(root);
			} else {
			}

			const template =
				this.alepha.state("ReactServerProvider.template") ??
				(await readFile(join(root, "index.html"), "utf-8"));

			for (const page of this.pageDescriptorProvider.getPages()) {
				this.serverRouterProvider.route({
					path: page.match,
					handler: this.createHandler(page, async () => template),
				});
			}

			this.alepha.state("ReactServerProvider.ssr", true);
		},
	});

	protected getPublicDirectory(): string {
		const maybe = [
			join(process.cwd(), this.env.REACT_SERVER_DIST),
			join(process.cwd(), "..", this.env.REACT_SERVER_DIST),
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
			cacheControl: true,
			immutable: true,
			maxAge: { days: 30 },
		});
	}

	protected configureVite() {
		const url = `http://${process.env.SERVER_HOST}:${process.env.SERVER_PORT}`;
		this.log.info("SSR (vite) OK");
		this.alepha.state("ReactServerProvider.ssr", true);
		const templateUrl = `${url}/index.html`;
		const templateLoader = () =>
			fetch(templateUrl)
				.then((it) => it.text())
				.catch(() => undefined);

		for (const page of this.pageDescriptorProvider.getPages()) {
			const handler = this.createHandler(page, templateLoader);
			this.serverRouterProvider.route({
				path: page.match,
				handler,
			});
		}
	}

	protected createRenderFunction(name: string) {
		return async (
			options: {
				params?: Record<string, string>;
				query?: Record<string, string>;
			} = {},
		) => {
			const page = this.pageDescriptorProvider.page(name);
			const state = await this.pageDescriptorProvider.createLayers(page, {
				url: new URL("http://localhost"),
				params: options.params ?? {},
				query: options.query ?? {},
				head: {},
				context: {},
			});
			return renderToString(this.pageDescriptorProvider.root(state));
		};
	}

	protected createHandler(
		page: PageRoute,
		templateLoader: () => Promise<string | undefined>,
	): ServerHandler {
		return async ({ url, user, reply, cookies, query, params }) => {
			const template = await templateLoader();
			if (!template) {
				throw new Error("Template not found");
			}

			const request: PageRequest = {
				url,
				params,
				query,
				head: {},
				context: {
					user, // user from request
				},
			};

			// const response = this.notFoundHandler(ctx.url);
			// if (response) {
			// 	// not found handler for static files (favicon, css, js, etc)
			// 	return response;
			// }

			const hasAuth = this.alepha.has(ReactAuthProvider);

			// -- user
			// if user is not set, we can have non-trusted user from cookie
			if (!request.context.user && cookies && hasAuth) {
				const auth = this.alepha.get(ReactAuthProvider);
				request.context.user = auth.user.get(cookies);
				if (request.context.user) {
					request.context.user.roles = []; // user from cookie is not trusted
				}
			}

			// -- links
			if (this.alepha.has(ServerLinksProvider) && hasAuth) {
				const srv = this.alepha.get(ServerLinksProvider);
				request.context.links = (await srv.links()) as any;
				this.alepha.als.set("links", request.context.links);
			}

			const state = await this.pageDescriptorProvider.createLayers(
				page,
				request,
			);

			if (state.redirect) {
				return reply.redirect(state.redirect);
			}

			const element = this.pageDescriptorProvider.root(state, request.context);

			const html = renderToString(element);
			const $ = load(template);

			// create hydration data
			const script = `<script>window.__ssr=${JSON.stringify({
				links: request.context.links,
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
			})}</script>`;

			// inject app into template
			const body = $("body");
			const root = body.find(`#${this.env.REACT_ROOT_ID}`);
			if (root.length) {
				root.html(html);
			} else {
				body.prepend(`<div id="${this.env.REACT_ROOT_ID}">${html}</div>`);
			}

			// inject ssr hydration data
			body.append(script);

			// inject head meta
			if (state.head) {
				this.renderHead($, state.head);
			}

			// render as string
			const text = $.html();

			reply.status = 200;
			reply.headers["content-type"] = "text/html";

			return text;
		};
	}

	protected renderHead($: CheerioAPI, head: Head) {
		const element = $("head");
		if (element.length) {
			if (head.title) {
				element.find("title").remove();
				element.append(`<title>${head.title}</title>`);
			}
			if (head.meta) {
				for (const it of head.meta) {
					const meta = element.find(`meta[name="${it.name}"]`);
					if (meta.length) {
						meta.attr("content", it.content);
					} else {
						element.append(
							`<meta name="${it.name}" content="${it.content}" />`,
						);
					}
				}
			}
		}

		if (head.htmlAttributes) {
			for (const [key, value] of Object.entries(head.htmlAttributes)) {
				$("html").attr(key, value);
			}
		}

		if (head.bodyAttributes) {
			for (const [key, value] of Object.entries(head.bodyAttributes)) {
				$("body").attr(key, value);
			}
		}
	}
}
