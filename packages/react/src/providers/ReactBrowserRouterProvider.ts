import { $hook, $inject, Alepha } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { type Route, RouterProvider } from "@alepha/router";
import { createElement, type ReactNode } from "react";
import NotFoundPage from "../components/NotFound.tsx";
import {
	isPageRoute,
	type PageRoute,
	type PageRouteEntry,
	type PreviousLayerData,
	ReactPageProvider,
	type ReactRouterState,
} from "./ReactPageProvider.ts";

export interface BrowserRoute extends Route {
	page: PageRoute;
}

export class ReactBrowserRouterProvider extends RouterProvider<BrowserRoute> {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly pageApi = $inject(ReactPageProvider);

	public add(entry: PageRouteEntry) {
		this.pageApi.add(entry);
	}

	protected readonly configure = $hook({
		on: "configure",
		handler: async () => {
			for (const page of this.pageApi.getPages()) {
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
		previous: PreviousLayerData[] = [],
	): Promise<string | void> {
		const { pathname, search } = url;

		const entry: Partial<ReactRouterState> = {
			url,
			query: {},
			params: {},
			layers: [],
			onError: () => null,
		};

		const state = entry as ReactRouterState;

		await this.alepha.emit("react:transition:begin", { state });

		try {
			const { route, params } = this.match(pathname);

			const query: Record<string, string> = {};
			if (search) {
				for (const [key, value] of new URLSearchParams(search).entries()) {
					query[key] = String(value);
				}
			}

			state.query = query;
			state.params = params ?? {};

			if (isPageRoute(route)) {
				const { redirect } = await this.pageApi.createLayers(
					route.page,
					state,
					previous,
				);
				if (redirect) {
					return redirect;
				}
			}

			if (state.layers.length === 0) {
				state.layers.push({
					name: "not-found",
					element: createElement(NotFoundPage),
					index: 0,
					path: "/",
				});
			}

			await this.alepha.emit("react:transition:success", { state });
		} catch (e) {
			this.log.error("Transition has failed", e);
			state.layers = [
				{
					name: "error",
					element: this.pageApi.renderError(e as Error),
					index: 0,
					path: "/",
				},
			];

			await this.alepha.emit("react:transition:error", {
				error: e as Error,
				state,
			});
		}

		// [feature]: local hook for leaving a page
		if (previous) {
			for (let i = 0; i < previous.length; i++) {
				const layer = previous[i];
				if (state.layers[i]?.name !== layer.name) {
					this.pageApi.page(layer.name)?.onLeave?.();
				}
			}
		}

		await this.alepha.emit("react:transition:end", {
			state,
		});

		this.alepha.state("react.router.state", state);
	}

	public root(state: ReactRouterState): ReactNode {
		return this.pageApi.root(state);
	}
}
