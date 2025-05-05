import { $inject, $logger, Alepha, EventEmitter } from "@alepha/core";
import type { MatchFunction, ParamData } from "path-to-regexp";
import { compile, match } from "path-to-regexp";
import type { ReactNode } from "react";
import { createElement } from "react";
import NestedView from "../components/NestedView.tsx";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import type {
	PageContext,
	PageDescriptorOptions,
} from "../descriptors/$page.ts";
import { RedirectionError } from "../errors/RedirectionError.ts";

export class ReactRouter extends EventEmitter<RouterEvents> {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly pages: PageRoute[] = [];
	protected notFoundPageRoute?: PageRoute;

	/**
	 * Get the page by name.
	 *
	 * @param name - Page name
	 * @return PageRoute
	 */
	public page(name: string): PageRoute {
		const found = this.pages.find((it) => it.name === name);
		if (!found) {
			throw new Error(`Page ${name} not found`);
		}

		return found;
	}

	/**
	 *
	 */
	public root(state: RouterState, context: PageContext = {}): ReactNode {
		return createElement(
			RouterContext.Provider,
			{
				value: {
					state,
					router: this,
					alepha: this.alepha,
					args: context,
				},
			},
			state.layers[0]?.element,
		);
	}

	/**
	 *
	 * @param url
	 * @param options
	 */
	public async render(
		url: string,
		options: RouterRenderOptions = {},
	): Promise<RouterRenderResult> {
		const [pathname, search = ""] = url.split("?");
		const state: RouterState = {
			pathname,
			search,
			layers: [],
			context: {},
		};

		await this.emit("begin", undefined);

		try {
			let layers = await this.match(url, options, state.context);
			if (layers.length === 0) {
				if (this.notFoundPageRoute) {
					layers = await this.createLayers(url, this.notFoundPageRoute);
				} else {
					layers.push({
						name: "not-found",
						element: "Not Found",
						index: 0,
						path: "/",
					});
				}
			}

			state.layers = layers;
			await this.emit("success", undefined);
		} catch (e) {
			if (e instanceof RedirectionError) {
				// redirect - stop processing
				return {
					element: null,
					layers: [],
					redirect: typeof e.page === "string" ? e.page : this.href(e.page),
					context: state.context,
				};
			}

			this.log.error(e);

			state.layers = [
				{
					name: "error",
					element: this.renderError(e as Error),
					index: 0,
					path: "/",
				},
			];

			await this.emit("error", e as Error);
		}

		if (options.state) {
			// stateful (csr)
			options.state.layers = state.layers;
			options.state.pathname = state.pathname;
			options.state.search = state.search;
			options.state.context = state.context;

			await this.emit("end", options.state);

			return {
				element: this.root(options.state, options.args),
				layers: options.state.layers,
				context: state.context,
			};
		}

		// stateless (ssr)
		await this.emit("end", state);
		return {
			element: this.root(state, options.args),
			layers: state.layers,
			context: state.context,
		};
	}

	/**
	 *
	 * @param url
	 * @param options
	 * @param context
	 * @protected
	 */
	public async match(
		url: string,
		options: RouterMatchOptions = {},
		context: RouterRenderContext = {},
	): Promise<Layer[]> {
		const pages = this.pages;
		const previous = options.previous;

		const [pathname, search] = url.split("?");

		for (const route of pages) {
			if (route.children?.find((it) => !it.path || it.path === "/")) continue;
			if (!route.match) continue;

			const match = route.match.exec(pathname);
			if (match) {
				const params = match.params ?? {};
				const query: Record<string, string> = {};
				if (search) {
					for (const [key, value] of new URLSearchParams(search).entries()) {
						query[key] = String(value);
					}
				}

				return await this.createLayers(
					url,
					route,
					params,
					query,
					previous,
					options.args,
					context,
				);
			}
		}

		return [];
	}

	/**
	 * Create layers for the given route.
	 *
	 * @param url
	 * @param route
	 * @param params
	 * @param query
	 * @param previous
	 * @param args
	 * @param renderContext
	 * @protected
	 */
	public async createLayers(
		url: string,
		route: PageRoute,
		params: Record<string, any> = {},
		query: Record<string, string> = {},
		previous: PreviousLayerData[] = [],
		args?: PageContext,
		renderContext?: RouterRenderContext,
	): Promise<Layer[]> {
		const layers: Layer[] = [];
		let context: Record<string, any> = {};
		const stack: Array<RouterStackItem> = [{ route }];

		let parent = route.parent;
		while (parent) {
			stack.unshift({ route: parent });
			parent = parent.parent;
		}

		let forceRefresh = false;

		for (let i = 0; i < stack.length; i++) {
			const it = stack[i];
			const route = it.route;
			const config: Record<string, any> = {};

			try {
				config.query = route.schema?.query
					? this.alepha.parse(route.schema.query, query)
					: query;
			} catch (e) {
				it.error = e as Error;
				break;
			}

			try {
				config.params = route.schema?.params
					? this.alepha.parse(route.schema.params, params)
					: params;
			} catch (e) {
				it.error = e as Error;
				break;
			}

			// save config
			it.config = {
				...config,
			};

			// no resolve, render a basic view by default
			if (!route.resolve) {
				continue;
			}

			// check if previous layer is the same, reuse if possible
			if (previous?.[i] && !forceRefresh && previous[i].name === route.name) {
				const url = (str?: string) => (str ? str.replace(/\/\/+/g, "/") : "/");

				const prev = JSON.stringify({
					part: url(previous[i].part),
					params: previous[i].config?.params ?? {},
				});

				const curr = JSON.stringify({
					part: url(route.path),
					params: config.params ?? {},
				});

				if (prev === curr) {
					// part is the same, reuse previous layer
					it.props = previous[i].props;
					it.error = previous[i].error;
					context = {
						...context,
						...it.props,
					};
					continue;
				}
				// part is different, force refresh of next layers
				forceRefresh = true;
			}

			try {
				const props =
					(await route.resolve?.(
						{
							...config,
							...context,
							context: args,
							url,
						} as any,
						args ?? {},
					)) ?? {};

				// save props
				it.props = {
					...props,
				};

				// add props to context
				context = {
					...context,
					...props,
				};
			} catch (e) {
				// check if we need to redirect
				if (e instanceof RedirectionError) {
					throw e; // redirect - stop processing
				}

				this.log.error(e);

				it.error = e as Error;
				break;
			}
		}

		let acc = "";
		for (let i = 0; i < stack.length; i++) {
			const it = stack[i];
			const props = it.props ?? {};

			const params = { ...it.config?.params };
			for (const key of Object.keys(params)) {
				params[key] = String(params[key]);
			}

			if (it.route.head && renderContext && !it.error) {
				this.mergeRenderContext(it.route, renderContext, {
					...props,
					...context,
				});
			}

			acc += "/";
			acc += it.route.path ? compile(it.route.path)(params) : "";
			const path = acc.replace(/\/+/, "/");

			// handler has thrown an error, render an error view
			if (it.error) {
				const errorHandler = this.getErrorHandler(it.route);
				const element = await (errorHandler
					? errorHandler({
							...it.config,
							error: it.error,
							url,
						})
					: this.renderError(it.error));

				layers.push({
					props,
					error: it.error,
					name: it.route.name,
					part: it.route.path,
					config: it.config,
					element: this.renderView(i + 1, path, element),
					index: i + 1,
					path,
				});
				break;
			}

			// normal use case

			const layer = await this.createElement(it.route, {
				...props,
				...context,
			});

			layers.push({
				name: it.route.name,
				props,
				part: it.route.path,
				config: it.config,
				element: this.renderView(i + 1, path, layer),
				index: i + 1,
				path,
			});
		}

		return layers;
	}

	/**
	 *
	 * @param route
	 * @protected
	 */
	protected getErrorHandler(route: PageRoute) {
		if (route.errorHandler) return route.errorHandler;
		let parent = route.parent;
		while (parent) {
			if (parent.errorHandler) return parent.errorHandler;
			parent = parent.parent;
		}
	}

	/**
	 *
	 * @param page
	 * @param props
	 * @protected
	 */
	protected async createElement(
		page: PageRoute,
		props: Record<string, any>,
	): Promise<ReactNode> {
		if (page.lazy) {
			const component = await page.lazy(); // load component
			return createElement(component.default, props);
		}

		if (page.component) {
			return createElement(page.component, props);
		}

		return undefined;
	}

	/**
	 * Merge the render context with the page context.
	 *
	 * @param page
	 * @param ctx
	 * @param props
	 * @protected
	 */
	protected mergeRenderContext(
		page: PageRoute,
		ctx: RouterRenderContext,
		props: Record<string, any>,
	): void {
		if (page.head) {
			ctx.head ??= {};

			const head =
				typeof page.head === "function"
					? page.head(props, ctx.head)
					: page.head;

			if (head.title) {
				ctx.head ??= {};

				if (ctx.head.titleSeparator) {
					ctx.head.title = `${head.title}${ctx.head.titleSeparator}${ctx.head.title}`;
				} else {
					ctx.head.title = head.title;
				}

				ctx.head.titleSeparator = head.titleSeparator;
			}

			if (head.htmlAttributes) {
				ctx.head.htmlAttributes = {
					...ctx.head.htmlAttributes,
					...head.htmlAttributes,
				};
			}

			if (head.bodyAttributes) {
				ctx.head.bodyAttributes = {
					...ctx.head.bodyAttributes,
					...head.bodyAttributes,
				};
			}

			if (head.meta) {
				ctx.head.meta = [...(ctx.head.meta ?? []), ...(head.meta ?? [])];
			}
		}
	}

	/**
	 *
	 * @param e
	 * @protected
	 */
	protected renderError(e: Error): ReactNode {
		return createElement("pre", { style: { overflow: "auto" } }, `${e.stack}`);
	}

	/**
	 * Render an empty view.
	 *
	 * @protected
	 */
	protected renderEmptyView(): ReactNode {
		return createElement(NestedView, {});
	}

	/**
	 * Create a valid href for the given page.
	 * @param page
	 * @param params
	 */
	public href(
		page: { options: { name?: string } },
		params: Record<string, any> = {},
	): string {
		const found = this.pages.find((it) => it.name === page.options.name);
		if (!found) {
			throw new Error(`Page ${page.options.name} not found`);
		}

		let url = found.path ?? "";
		let parent = found.parent;
		while (parent) {
			url = `${parent.path ?? ""}/${url}`;
			parent = parent.parent;
		}

		url = compile(url)(params);

		return url.replace(/\/\/+/g, "/") || "/";
	}

	/**
	 *
	 * @param index
	 * @param path
	 * @param view
	 * @protected
	 */
	protected renderView(
		index: number,
		path: string,
		view: ReactNode = this.renderEmptyView(),
	): ReactNode {
		return createElement(
			RouterLayerContext.Provider,
			{
				value: {
					index,
					path,
				},
			},
			view,
		);
	}

	/**
	 *
	 * @param entry
	 */
	public add(entry: PageRouteEntry) {
		if (this.alepha.isReady()) {
			throw new Error("Router is already initialized");
		}

		if (entry.notFoundHandler) {
			this.notFoundPageRoute = {
				name: "not-found",
				component: entry.notFoundHandler,
			};
		}

		entry.name ??= this.nextId();
		const page = entry as PageRoute;

		page.match = this.createMatchFunction(page);
		this.pages.push(page);

		if (page.children) {
			for (const child of page.children) {
				child.parent = page;
				this.add(child);
			}
		}
	}

	/**
	 * Create a match function for the given page.
	 *
	 * @param page
	 * @protected
	 */
	protected createMatchFunction(
		page: PageRoute,
	): { exec: MatchFunction<ParamData>; path: string } | undefined {
		let url = page.path ?? "/";
		let target = page.parent;
		while (target) {
			url = `${target.path ?? ""}/${url}`;
			target = target.parent;
		}

		let path = url.replace(/\/\/+/g, "/");

		if (path.endsWith("/")) {
			// remove trailing slash
			path = path.slice(0, -1);
		}

		if (path.includes("?")) {
			return {
				exec: match(path.split("?")[0]),
				path,
			};
		}

		return {
			exec: match(path),
			path,
		};
	}

	/**
	 *
	 */
	public empty() {
		return this.pages.length === 0;
	}

	/**
	 *
	 * @protected
	 */
	protected _next = 0;

	/**
	 *
	 * @protected
	 */
	protected nextId(): string {
		this._next += 1;
		return `P${this._next}`;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export interface PageRouteEntry
	extends Omit<PageDescriptorOptions, "children" | "parent"> {
	/**
	 *
	 */
	name?: string;

	/**
	 *
	 */
	match?: {
		/**
		 *
		 */
		exec: MatchFunction<ParamData>;

		/**
		 *
		 */
		path: string;
	};

	/**
	 *
	 */
	children?: PageRouteEntry[];

	/**
	 *
	 */
	parent?: PageRoute;
}

export interface PageRoute extends PageRouteEntry {
	/**
	 *
	 */
	name: string;

	/**
	 *
	 */
	parent?: PageRoute;
}

export interface Layer {
	/**
	 *
	 */
	config?: {
		/**
		 *
		 */
		query?: Record<string, any>;

		/**
		 *
		 */
		params?: Record<string, any>;

		/**
		 *
		 */
		context?: Record<string, any>;
	};

	/**
	 *
	 */
	name: string;

	/**
	 *
	 */
	props?: Record<string, any>;

	/**
	 *
	 */
	error?: Error;

	/**
	 *
	 */
	part?: string;

	/**
	 *
	 */
	element: ReactNode;

	/**
	 *
	 */
	index: number;

	/**
	 *
	 */
	path: string;
}

/**
 *
 */
export type PreviousLayerData = Omit<Layer, "element">;

export interface AnchorProps {
	/**
	 *
	 */
	href?: string;

	/**
	 *
	 * @param ev
	 */
	onClick?: (ev: any) => any;
}

export interface RouterMatchOptions {
	/**
	 *
	 */
	previous?: PreviousLayerData[];

	/**
	 *
	 */
	args?: PageContext;
}

export interface RouterEvents {
	/**
	 *
	 */
	begin: undefined;

	/**
	 *
	 */
	success: undefined;

	/**
	 *
	 */
	error: Error;

	/**
	 *
	 */
	end: RouterState;
}

export interface RouterState {
	/**
	 *
	 */
	pathname: string;

	/**
	 *
	 */
	search: string;

	/**
	 *
	 */
	layers: Array<Layer>;

	/**
	 *
	 */
	context: RouterRenderContext;
}

export interface RouterRenderContext {
	/**
	 *
	 */
	head?: RouterRenderHeadContext;
}

export interface RouterRenderOptions extends RouterMatchOptions {
	/**
	 * State to update.
	 */
	state?: RouterState;
}

export interface RouterStackItem {
	/**
	 *
	 */
	route: PageRoute;

	/**
	 *
	 */
	config?: Record<string, any>;

	/**
	 *
	 */
	props?: Record<string, any>;

	/**
	 *
	 */
	error?: Error;
}

export interface RouterRenderHeadContext {
	/**
	 *
	 */
	title?: string;

	/**
	 *
	 */
	titleSeparator?: string;

	/**
	 * Add html attributes to the <html> tag.
	 */
	htmlAttributes?: Record<string, string>;

	/**
	 * Add html attributes to the <body> tag.
	 */
	bodyAttributes?: Record<string, string>;

	/**
	 *
	 */
	meta?: Array<{ name: string; content: string }>;
}

export interface RouterRenderResult {
	/**
	 *
	 */
	element: ReactNode;

	/**
	 *
	 */
	layers: Layer[];

	/**
	 *
	 */
	redirect?: string;

	/**
	 *
	 */
	context: RouterRenderContext;
}
