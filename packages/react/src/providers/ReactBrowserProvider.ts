import { $hook, $inject, $logger, Alepha, type Static, t } from "@alepha/core";
import { HttpClient, type HttpClientLink } from "@alepha/server";
import type { Root } from "react-dom/client";
import { createRoot, hydrateRoot } from "react-dom/client";
import type { Head } from "../descriptors/$page.ts";
import { BrowserHeadProvider } from "./BrowserHeadProvider.ts";
import { BrowserRouterProvider } from "./BrowserRouterProvider.ts";
import type {
	PreviousLayerData,
	RouterState,
	TransitionOptions,
} from "./PageDescriptorProvider.ts";

const envSchema = t.object({
	REACT_ROOT_ID: t.string({ default: "root" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class ReactBrowserProvider {
	protected readonly log = $logger();
	protected readonly client = $inject(HttpClient);
	protected readonly alepha = $inject(Alepha);
	protected readonly router = $inject(BrowserRouterProvider);
	protected readonly headProvider = $inject(BrowserHeadProvider);
	protected readonly env = $inject(envSchema);
	protected root!: Root;

	public transitioning?: {
		to: string;
	};

	public state: RouterState = {
		layers: [],
		pathname: "",
		search: "",
		head: {},
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

	/**
	 *
	 * @param url
	 * @param options
	 */
	public async go(url: string, options: RouterGoOptions = {}): Promise<void> {
		const result = await this.render({
			url,
		});

		if (result.url !== url) {
			this.history.replaceState({}, "", result.url);
			return;
		}

		if (options.replace) {
			this.history.replaceState({}, "", url);
			return;
		}

		this.history.pushState({}, "", url);
	}

	protected async render(
		options: {
			url?: string;
			previous?: PreviousLayerData[];
		} = {},
	): Promise<{ url: string; head: Head }> {
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

		return { url, head: result.head };
	}

	/**
	 * Get embedded layers from the server.
	 *
	 * @protected
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

	/**
	 *
	 * @protected
	 */
	protected getRootElement() {
		const root = this.document.getElementById(this.env.REACT_ROOT_ID);
		if (root) {
			return root;
		}

		const div = this.document.createElement("div");
		div.id = this.env.REACT_ROOT_ID;

		this.document.body.prepend(div);

		return div;
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 *
	 * @protected
	 */
	public readonly ready = $hook({
		name: "ready",
		handler: async () => {
			const hydration = this.getHydrationState();
			const previous = hydration?.layers ?? [];

			if (hydration?.links) {
				for (const link of hydration.links) {
					this.client.pushLink(link);
				}
			}

			const { head } = await this.render({ previous });
			if (head) {
				this.headProvider.renderHead(this.document, head);
			}

			const context = {};

			await this.alepha.emit("react:browser:render", {
				context,
				hydration,
			});

			const element = this.router.root(this.state, context);

			if (previous.length > 0) {
				this.root = hydrateRoot(this.getRootElement(), element);
				this.log.info("Hydrated root element");
			} else {
				this.root ??= createRoot(this.getRootElement());
				this.root.render(element);
				this.log.info("Created root element");
			}

			window.addEventListener("popstate", () => {
				this.render();
			});

			this.alepha.on("react:transition:end", {
				callback: ({ state }) => {
					this.headProvider.renderHead(this.document, state.head);
				},
			});
		},
	});

	public readonly onTransitionEnd = $hook({
		name: "react:transition:end",
		handler: async ({ state }) => {
			this.headProvider.renderHead(this.document, state.head);
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
	layers?: PreviousLayerData[];
	links?: HttpClientLink[];
}
