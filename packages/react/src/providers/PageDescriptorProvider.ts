import type { Static } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, OPTIONS, t } from "@alepha/core";
import type { ApiLinksResponse } from "@alepha/server";
import { createElement, type ReactNode, StrictMode } from "react";
import ClientOnly from "../components/ClientOnly.tsx";
import ErrorViewer from "../components/ErrorViewer.tsx";
import NestedView from "../components/NestedView.tsx";
import { RouterContext } from "../contexts/RouterContext.ts";
import { RouterLayerContext } from "../contexts/RouterLayerContext.ts";
import {
	$page,
	type Head,
	type PageDescriptorOptions,
} from "../descriptors/$page.ts";
import { RedirectionError } from "../errors/RedirectionError.ts";

const envSchema = t.object({
	REACT_STRICT_MODE: t.boolean({ default: true }),
});

declare module "@alepha/core" {
	export interface Env extends Partial<Static<typeof envSchema>> {}
}

export class PageDescriptorProvider {
	protected readonly log = $logger();
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);
	protected readonly pages: PageRoute[] = [];

	public getPages(): PageRoute[] {
		return this.pages;
	}

	public page(name: string): PageRoute {
		for (const page of this.pages) {
			if (page.name === name) {
				return page;
			}
		}

		throw new Error(`Page ${name} not found`);
	}

	public url(
		name: string,
		options: { params?: Record<string, string>; base?: string } = {},
	): URL {
		const page = this.page(name);
		if (!page) {
			throw new Error(`Page ${name} not found`);
		}

		let url = page.path ?? "";
		let parent = page.parent;
		while (parent) {
			url = `${parent.path ?? ""}/${url}`;
			parent = parent.parent;
		}

		url = this.compile(url, options.params ?? {});

		return new URL(
			url.replace(/\/\/+/g, "/") || "/",
			options.base ?? `http://localhost`,
		);
	}

	public root(state: RouterState, context: PageReactContext): ReactNode {
		const root = createElement(
			RouterContext.Provider,
			{
				value: {
					alepha: this.alepha,
					state,
					context,
				},
			},
			createElement(NestedView, {}, state.layers[0]?.element),
		);

		if (this.env.REACT_STRICT_MODE) {
			return createElement(StrictMode, {}, root);
		}

		return root;
	}

	public async createLayers(
		route: PageRoute,
		request: PageRequest,
	): Promise<CreateLayersResult> {
		const { pathname, search } = request.url;
		const layers: Layer[] = []; // result layers
		let context: Record<string, any> = {}; // all props
		const stack: Array<RouterStackItem> = [{ route }]; // stack of routes
		request.onError = (error) => this.renderError(error); // error handler

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
					? this.alepha.parse(route.schema.query, request.query)
					: request.query;
			} catch (e) {
				it.error = e as Error;
				break;
			}

			try {
				config.params = route.schema?.params
					? this.alepha.parse(route.schema.params, request.params)
					: request.params;
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
			const previous = request.previous;
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
					(await route.resolve?.({
						...request, // request
						...config, // params, query
						...context, // previous props
					} as any)) ?? {};

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
					return {
						layers: [],
						redirect: typeof e.page === "string" ? e.page : this.href(e.page),
						pathname,
						search,
					};
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

			if (it.route.head && !it.error) {
				this.fillHead(it.route, request, {
					...props,
					...context,
				});
			}

			acc += "/";
			acc += it.route.path ? this.compile(it.route.path, params) : "";
			const path = acc.replace(/\/+/, "/");
			const localErrorHandler = this.getErrorHandler(it.route);
			if (localErrorHandler) {
				request.onError = localErrorHandler;
			}

			// handler has thrown an error, render an error view
			if (it.error) {
				let element: ReactNode = await request.onError(it.error);
				if (element === null) {
					element = this.renderError(it.error);
				}

				layers.push({
					props,
					error: it.error,
					name: it.route.name,
					part: it.route.path,
					config: it.config,
					element: this.renderView(i + 1, path, element, it.route),
					index: i + 1,
					path,
				});
				break;
			}

			// normal use case

			const element = await this.createElement(it.route, {
				...props,
				...context,
			});

			layers.push({
				name: it.route.name,
				props,
				part: it.route.path,
				config: it.config,
				element: this.renderView(i + 1, path, element, it.route),
				index: i + 1,
				path,
			});
		}

		return { layers, pathname, search };
	}

	protected getErrorHandler(route: PageRoute) {
		if (route.errorHandler) return route.errorHandler;
		let parent = route.parent;
		while (parent) {
			if (parent.errorHandler) return parent.errorHandler;
			parent = parent.parent;
		}
	}

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

	protected fillHead(
		page: PageRoute,
		ctx: PageRequest,
		props: Record<string, any>,
	): void {
		if (!page.head) {
			return;
		}

		ctx.head ??= {};

		const head =
			typeof page.head === "function" ? page.head(props, ctx.head) : page.head;

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

	public renderError(error: Error): ReactNode {
		return createElement(ErrorViewer, { error });
	}

	public renderEmptyView(): ReactNode {
		return createElement(NestedView, {});
	}

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

		url = this.compile(url, params);

		return url.replace(/\/\/+/g, "/") || "/";
	}

	public compile(path: string, params: Record<string, string> = {}) {
		for (const [key, value] of Object.entries(params)) {
			path = path.replace(`:${key}`, value);
		}
		return path;
	}

	protected renderView(
		index: number,
		path: string,
		view: ReactNode | undefined,
		page: PageRoute,
	): ReactNode {
		view ??= this.renderEmptyView();

		const element = page.client
			? createElement(
					ClientOnly,
					typeof page.client === "object" ? page.client : {},
					view,
				)
			: view;

		return createElement(
			RouterLayerContext.Provider,
			{
				value: {
					index,
					path,
				},
			},
			element,
		);
	}

	protected readonly configure = $hook({
		name: "configure",
		handler: () => {
			const pages = this.alepha.getDescriptorValues($page);
			for (const { value, key } of pages) {
				value[OPTIONS].name ??= key;
			}
			for (const { value } of pages) {
				// skip children, we only want root pages
				if (value[OPTIONS].parent) {
					continue;
				}

				this.add(this.map(pages, value));
			}
		},
	});

	protected map(
		pages: Array<{ value: { [OPTIONS]: PageDescriptorOptions } }>,
		target: { [OPTIONS]: PageDescriptorOptions },
	): PageRouteEntry {
		const children = target[OPTIONS].children ?? [];

		return {
			...target[OPTIONS],
			parent: undefined,
			children: children.map((it) => this.map(pages, it)),
		} as PageRoute;
	}

	public add(entry: PageRouteEntry) {
		if (this.alepha.isReady()) {
			throw new Error("Router is already initialized");
		}

		entry.name ??= this.nextId();
		const page = entry as PageRoute;

		page.match = this.createMatch(page);
		this.pages.push(page);

		if (page.children) {
			for (const child of page.children) {
				(child as PageRoute).parent = page;
				this.add(child);
			}
		}
	}

	protected createMatch(page: PageRoute): string {
		let url = page.path ?? "/";
		let target = page.parent;
		while (target) {
			url = `${target.path ?? ""}/${url}`;
			target = target.parent;
		}

		let path = url.replace(/\/\/+/g, "/");

		if (path.endsWith("/") && path !== "/") {
			// remove trailing slash
			path = path.slice(0, -1);
		}

		return path;
	}

	protected _next = 0;

	protected nextId(): string {
		this._next += 1;
		return `P${this._next}`;
	}
}

export const isPageRoute = (it: any): it is PageRoute => {
	return (
		it &&
		typeof it === "object" &&
		typeof it.path === "string" &&
		typeof it.page === "object"
	);
};

export interface PageRouteEntry
	extends Omit<PageDescriptorOptions, "children" | "parent"> {
	children?: PageRouteEntry[];
}

export interface PageRoute extends PageRouteEntry {
	type: "page";
	name: string;
	parent?: PageRoute;
	match: string;
}

export interface Layer {
	config?: {
		query?: Record<string, any>;
		params?: Record<string, any>;
		// stack of resolved props
		context?: Record<string, any>;
	};

	name: string;
	props?: Record<string, any>;
	error?: Error;
	part?: string;
	element: ReactNode;
	index: number;
	path: string;
}

export type PreviousLayerData = Omit<Layer, "element" | "index" | "path">;

export interface AnchorProps {
	href: string;
	onClick: (ev: any) => any;
}

export interface RouterState {
	pathname: string;
	search: string;
	layers: Array<Layer>;
}

export interface TransitionOptions {
	state?: RouterState;
	previous?: PreviousLayerData[];
	context?: PageReactContext;
}

export interface RouterStackItem {
	route: PageRoute;
	config?: Record<string, any>;
	props?: Record<string, any>;
	error?: Error;
}

export interface RouterRenderResult {
	state: RouterState;
	context: PageReactContext;
	redirect?: string;
}

export interface PageRequest extends PageReactContext {
	params: Record<string, any>;
	query: Record<string, string>;

	// previous layers (browser history or browser hydration, always null on server)
	previous?: PreviousLayerData[];
}

export interface CreateLayersResult extends RouterState {
	redirect?: string;
}

/**
 * It's like RouterState, but publicly available in React context.
 * This is where we store all plugin data!
 */
export interface PageReactContext {
	url: URL;
	head: Head;
	onError: (error: Error) => ReactNode;
	links?: ApiLinksResponse;
}
