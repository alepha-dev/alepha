import {
	$env,
	$hook,
	$inject,
	$logger,
	Alepha,
	type State,
	type Static,
	t,
} from "@alepha/core";
import { LinkProvider } from "@alepha/server-links";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { ReactBrowserRouterProvider } from "./ReactBrowserRouterProvider.ts";
import type {
	PreviousLayerData,
	ReactRouterState,
	TransitionOptions,
} from "./ReactPageProvider.ts";

const envSchema = t.object({
	REACT_ROOT_ID: t.string({ default: "root" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export interface ReactBrowserRendererOptions {
	scrollRestoration?: "top" | "manual";
}

export class ReactBrowserProvider {
	protected readonly env = $env(envSchema);
	protected readonly log = $logger();
	protected readonly client = $inject(LinkProvider);
	protected readonly alepha = $inject(Alepha);
	protected readonly router = $inject(ReactBrowserRouterProvider);
	protected root?: Root;

	public options: ReactBrowserRendererOptions = {
		scrollRestoration: "top",
	};

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

	public transitioning?: {
		to: string;
		from?: string;
	};

	public get state(): ReactRouterState {
		return this.alepha.state("react.router.state")!;
	}

	/**
	 * Accessor for Document DOM API.
	 */
	public get document() {
		return window.document;
	}

	/**
	 * Accessor for History DOM API.
	 */
	public get history() {
		return window.history;
	}

	/**
	 * Accessor for Location DOM API.
	 */
	public get location() {
		return window.location;
	}

	public get base() {
		return import.meta.env?.BASE_URL ?? "";
	}

	public get url(): string {
		const url = this.location.pathname + this.location.search;
		if (this.base) {
			return url.replace(this.base, "/");
		}
		return url;
	}

	public pushState(path: string, replace?: boolean) {
		const url = this.base + path;

		if (replace) {
			this.history.replaceState({}, "", url);
		} else {
			this.history.pushState({}, "", url);
		}
	}

	public async invalidate(props?: Record<string, any>) {
		const previous: PreviousLayerData[] = [];

		this.log.trace("Invalidating layers");

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
		this.log.trace(`Going to ${url}`, {
			url,
			options,
		});

		await this.render({
			url,
			previous: options.force ? [] : this.state.layers,
		});

		// when redirecting in browser
		if (this.state.url.pathname + this.state.url.search !== url) {
			this.pushState(this.state.url.pathname + this.state.url.search);
			return;
		}

		this.pushState(url, options.replace);
	}

	protected async render(
		options: { url?: string; previous?: PreviousLayerData[] } = {},
	): Promise<void> {
		const previous = options.previous ?? this.state.layers;
		const url = options.url ?? this.url;

		this.transitioning = {
			to: url,
		};

		this.log.debug("Transitioning...", {
			to: url,
		});

		const redirect = await this.router.transition(
			new URL(`http://localhost${url}`),
			previous,
		);

		if (redirect) {
			this.log.info("Redirecting to", {
				redirect,
			});
			return await this.render({ url: redirect });
		}

		this.log.info("Transition OK", {
			to: url,
		});

		this.transitioning = undefined;
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

	protected readonly onTransitionEnd = $hook({
		on: "react:transition:end",
		handler: () => {
			if (
				this.options.scrollRestoration === "top" &&
				typeof window !== "undefined"
			) {
				this.log.trace("Restoring scroll position to top");
				window.scrollTo(0, 0);
			}
		},
	});

	public readonly ready = $hook({
		on: "ready",
		handler: async () => {
			const hydration = this.getHydrationState();
			const previous = hydration?.layers ?? [];

			if (hydration) {
				// low budget, but works for now
				for (const [key, value] of Object.entries(hydration)) {
					if (key !== "layers") {
						this.alepha.state(key as keyof State, value);
					}
				}
			}

			await this.render({ previous });

			const element = this.router.root(this.state);
			if (hydration?.layers) {
				this.root = hydrateRoot(this.getRootElement(), element);
				this.log.info("Hydrated root element");
			} else {
				this.root ??= createRoot(this.getRootElement());
				this.root.render(element);
				this.log.info("Created root element");
			}

			window.addEventListener("popstate", () => {
				// when you update silently queryparams or hash, skip rendering
				// if you want to force a rendering, use #go()
				if (this.state.url.pathname === this.location.pathname) {
					return;
				}

				this.log.debug("Popstate event triggered - rendering new state", {
					url: this.location.pathname + this.location.search,
				});

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
