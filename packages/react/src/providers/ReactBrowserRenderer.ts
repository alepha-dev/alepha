import { $hook, $inject, $logger, type Static, t } from "@alepha/core";
import type { ApiLinksResponse } from "@alepha/server";
import type { Root } from "react-dom/client";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouterProvider } from "./BrowserRouterProvider.ts";
import type {
	PreviousLayerData,
	TransitionOptions,
} from "./PageDescriptorProvider.ts";
import { ReactBrowserProvider } from "./ReactBrowserProvider.ts";

const envSchema = t.object({
	REACT_ROOT_ID: t.string({ default: "root" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class ReactBrowserRenderer {
	protected readonly browserProvider = $inject(ReactBrowserProvider);
	protected readonly browserRouterProvider = $inject(BrowserRouterProvider);
	protected readonly env = $inject(envSchema);
	protected readonly log = $logger();

	protected root!: Root;

	protected getRootElement() {
		const root = this.browserProvider.document.getElementById(
			this.env.REACT_ROOT_ID,
		);
		if (root) {
			return root;
		}

		const div = this.browserProvider.document.createElement("div");
		div.id = this.env.REACT_ROOT_ID;

		this.browserProvider.document.body.prepend(div);

		return div;
	}

	public readonly ready = $hook({
		name: "react:browser:render",
		handler: async ({ state, context, hydration }) => {
			const element = this.browserRouterProvider.root(state, context);

			if (hydration?.layers) {
				this.root = hydrateRoot(this.getRootElement(), element);
				this.log.info("Hydrated root element");
			} else {
				this.root ??= createRoot(this.getRootElement());
				this.root.render(element);
				this.log.info("Created root element");
			}
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
