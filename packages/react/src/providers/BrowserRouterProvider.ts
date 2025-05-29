import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { type Route, RouterProvider } from "@alepha/router";
import type { ReactNode } from "react";
import {
	PageDescriptorProvider,
	type PageReactContext,
	type PageRequest,
	type PageRoute,
	type PageRouteEntry,
	type RouterRenderResult,
	type RouterState,
	type TransitionOptions,
	isPageRoute,
} from "./PageDescriptorProvider.ts";

export interface BrowserRoute extends Route {
	page: PageRoute;
}

export class BrowserRouterProvider extends RouterProvider<BrowserRoute> {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly pageDescriptorProvider = $inject(PageDescriptorProvider);

	public add(entry: PageRouteEntry) {
		this.pageDescriptorProvider.add(entry);
	}

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			for (const page of this.pageDescriptorProvider.getPages()) {
				// mount only if a view is provided
				if (page.component || page.lazy) {
					this.push({
						path: page.match,
						page,
					});
				}
			}
		},
	});

	public async transition(
		url: URL,
		options: TransitionOptions = {},
	): Promise<RouterRenderResult> {
		const { pathname, search } = url;
		const state: RouterState = {
			pathname,
			search,
			layers: [],
			head: {},
		};

		await this.alepha.emit("react:transition:begin", { state });

		const request: PageRequest = {
			url,
			query: {},
			params: {},
			...state,
			head: state.head,
			...(options.context ?? {}),
		};

		try {
			const previous = options.previous;
			const { route, params } = this.match(pathname);

			const query: Record<string, string> = {};
			if (search) {
				for (const [key, value] of new URLSearchParams(search).entries()) {
					query[key] = String(value);
				}
			}

			request.query = query;
			request.params = params ?? {};
			request.previous = previous;

			if (isPageRoute(route)) {
				const result = await this.pageDescriptorProvider.createLayers(
					route.page,
					request,
				);

				if (result.redirect) {
					return {
						layers: [],
						redirect: result.redirect,
						head: state.head,
						context: request,
					};
				}

				state.layers = result.layers;
				state.head = result.head;
			}

			if (state.layers.length === 0) {
				state.layers.push({
					name: "not-found",
					element: "Not Found",
					index: 0,
					path: "/",
				});
			}

			await this.alepha.emit("react:transition:success", { state });
		} catch (e) {
			this.log.error(e);
			state.layers = [
				{
					name: "error",
					element: this.pageDescriptorProvider.renderError(e as Error),
					index: 0,
					path: "/",
				},
			];

			await this.alepha.emit("react:transition:error", {
				error: e as Error,
				state,
			});
		}

		if (!options.state) {
			await this.alepha.emit("react:transition:end", {
				state,
			});
			return {
				context: request,
				layers: state.layers,
				head: state.head,
			};
		}

		options.state.layers = state.layers;
		options.state.pathname = state.pathname;
		options.state.search = state.search;
		options.state.head = state.head;

		await this.alepha.emit("react:transition:end", {
			state: options.state,
		});

		return {
			context: request,
			layers: options.state.layers,
			head: state.head,
		};
	}

	public root(state: RouterState, context: PageReactContext): ReactNode {
		return this.pageDescriptorProvider.root(state, context);
	}
}
