import { $hook, $inject, $logger, Alepha, type State } from "@alepha/core";
import { ApiLinksResponse, LinkProvider } from "@alepha/server-links";
import type { Root } from "react-dom/client";
import { BrowserRouterProvider } from "./BrowserRouterProvider.ts";
import type {
	PreviousLayerData,
	RouterRenderResult,
	RouterState,
	TransitionOptions,
} from "./PageDescriptorProvider.ts";

export class ReactBrowserProvider {
	protected readonly log = $logger();
	protected readonly client = $inject(LinkProvider);
	protected readonly alepha = $inject(Alepha);
	protected readonly router = $inject(BrowserRouterProvider);
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

	public get location() {
		return window.location;
	}

	public get url(): string {
		let url = this.location.pathname + this.location.search;

		if (import.meta?.env?.BASE_URL) {
			url = url.replace(import.meta.env?.BASE_URL, "");
			if (!url.startsWith("/")) {
				url = `/${url}`;
			}
		}

		return url;
	}

	public pushState(url: string, replace?: boolean) {
		let path = url;

		if (import.meta?.env?.BASE_URL) {
			path = (import.meta.env?.BASE_URL + path).replaceAll("//", "/");
		}

		if (replace) {
			this.history.replaceState({}, "", path);
		} else {
			this.history.pushState({}, "", path);
		}
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
			previous: options.force ? [] : this.state.layers,
		});

		// when redirecting in browser
		if (result.context.url.pathname + result.context.url.search !== url) {
			this.pushState(result.context.url.pathname + result.context.url.search);
			return;
		}

		this.pushState(url, options.replace);
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
		on: "ready",
		handler: async () => {
			const hydration = this.getHydrationState();
			const previous = hydration?.layers ?? [];

			if (hydration) {
				for (const [key, value] of Object.entries(hydration)) {
					if (key !== "layers") {
						this.alepha.state(key as keyof State, value);
					}
				}
			}

			const { context } = await this.render({ previous });

			await this.alepha.emit("react:browser:render", {
				state: this.state,
				context,
				hydration,
			});

			window.addEventListener("popstate", () => {
				// when you update silently queryparams or hash, skip rendering
				// if you want to force a rendering, use #go()
				if (this.state.pathname === this.url) {
					return;
				}

				this.render();
			});
		},
	});
}

// ---------------------------------------------------------------------------------------------------------------------

export interface RouterGoOptions {
	replace?: boolean;
	match?: TransitionOptions;
	params?: Record<string, string>;
	query?: Record<string, string>;

	/**
	 * Recreate the whole page, ignoring the current state.
	 */
	force?: boolean;
}

export type ReactHydrationState = {
	layers?: Array<PreviousLayerData>;
} & {
	[key: string]: any;
};
