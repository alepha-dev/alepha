import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { type ApiLinksResponse, HttpClient } from "@alepha/server";
import type { Root } from "react-dom/client";
import { BrowserHeadProvider } from "./BrowserHeadProvider.ts";
import { BrowserRouterProvider } from "./BrowserRouterProvider.ts";
import type {
	PreviousLayerData,
	RouterRenderResult,
	RouterState,
	TransitionOptions,
} from "./PageDescriptorProvider.ts";

export class ReactBrowserProvider {
	protected readonly log = $logger();
	protected readonly client = $inject(HttpClient);
	protected readonly alepha = $inject(Alepha);
	protected readonly router = $inject(BrowserRouterProvider);
	protected readonly headProvider = $inject(BrowserHeadProvider);
	protected root!: Root;

	public transitioning?: {
		to: string;
	};

	public state: RouterState = {
		layers: [],
		pathname: "",
		search: "",
	};

	public get document() {
		return window.document;
	}

	public get history() {
		return window.history;
	}

	public get url(): string {
		return window.location.pathname + window.location.search;
	}

	public async invalidate(props?: Record<string, any>) {
		const previous: PreviousLayerData[] = [];

		if (props) {
			const [key] = Object.keys(props);
			const value = props[key];

			for (const layer of this.state.layers) {
				if (layer.props?.[key]) {
					previous.push({
						...layer,
						props: {
							...layer.props,
							[key]: value,
						},
					});
					break;
				}
				previous.push(layer);
			}
		}

		await this.render({ previous });
	}

	public async go(url: string, options: RouterGoOptions = {}): Promise<void> {
		const result = await this.render({
			url,
		});

		// when redirecting in browser
		if (result.context.url.pathname !== url) {
			// TODO: check if losing search params is acceptable?
			this.history.replaceState({}, "", result.context.url.pathname);
			return;
		}

		if (options.replace) {
			this.history.replaceState({}, "", url);
			return;
		}

		this.history.pushState({}, "", url);
	}

	protected async render(
		options: { url?: string; previous?: PreviousLayerData[] } = {},
	): Promise<RouterRenderResult> {
		const previous = options.previous ?? this.state.layers;
		const url = options.url ?? this.url;

		this.transitioning = { to: url };

		const result = await this.router.transition(
			new URL(`http://localhost${url}`),
			{
				previous,
				state: this.state,
			},
		);

		if (result.redirect) {
			return await this.render({ url: result.redirect });
		}

		this.transitioning = undefined;

		return result;
	}

	/**
	 * Get embedded layers from the server.
	 */
	protected getHydrationState(): ReactHydrationState | undefined {
		try {
			if ("__ssr" in window && typeof window.__ssr === "object") {
				return window.__ssr as ReactHydrationState;
			}
		} catch (error) {
			console.error(error);
		}
	}

	// -------------------------------------------------------------------------------------------------------------------

	public readonly ready = $hook({
		name: "ready",
		handler: async () => {
			const hydration = this.getHydrationState();
			const previous = hydration?.layers ?? [];

			if (hydration?.links) {
				for (const link of hydration.links.links) {
					this.client.pushLink(link);
				}
			}

			const { context } = await this.render({ previous });
			if (context.head) {
				this.headProvider.renderHead(this.document, context.head);
			}

			await this.alepha.emit("react:browser:render", {
				state: this.state,
				context,
				hydration,
			});

			window.addEventListener("popstate", () => {
				this.render();
			});
		},
	});

	public readonly onTransitionEnd = $hook({
		name: "react:transition:end",
		handler: async ({ context }) => {
			this.headProvider.renderHead(this.document, context.head);
		},
	});
}

// ---------------------------------------------------------------------------------------------------------------------

export interface RouterGoOptions {
	replace?: boolean;
	match?: TransitionOptions;
	params?: Record<string, string>;
}

export interface ReactHydrationState {
	layers?: Array<PreviousLayerData>;
	links?: ApiLinksResponse;
}
