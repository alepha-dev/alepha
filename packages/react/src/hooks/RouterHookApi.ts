import type { PageDescriptor } from "../descriptors/$page.ts";
import type {
	AnchorProps,
	RouterState,
} from "../providers/PageDescriptorProvider.ts";
import type {
	ReactBrowserProvider,
	RouterGoOptions,
} from "../providers/ReactBrowserProvider.ts";

export class RouterHookApi {
	constructor(
		private readonly state: RouterState,
		private readonly layer: {
			path: string;
		},
		private readonly browser?: ReactBrowserProvider,
	) {}

	/**
	 *
	 */
	public get current(): RouterState {
		return this.state;
	}

	/**
	 *
	 */
	public get pathname(): string {
		return this.state.pathname;
	}

	/**
	 *
	 */
	public get query(): Record<string, string> {
		const query: Record<string, string> = {};

		for (const [key, value] of new URLSearchParams(
			this.state.search,
		).entries()) {
			query[key] = String(value);
		}

		return query;
	}

	/**
	 *
	 */
	public async back() {
		this.browser?.history.back();
	}

	/**
	 *
	 */
	public async forward() {
		this.browser?.history.forward();
	}

	/**
	 *
	 * @param props
	 */
	public async invalidate(props?: Record<string, any>) {
		await this.browser?.invalidate(props);
	}

	/**
	 * Create a valid href for the given pathname.
	 *
	 * @param pathname
	 * @param layer
	 */
	public createHref(pathname: HrefLike, layer: { path: string } = this.layer) {
		if (typeof pathname === "object") {
			pathname = pathname.options.path ?? "";
		}

		return pathname.startsWith("/")
			? pathname
			: `${layer.path}/${pathname}`.replace(/\/\/+/g, "/");
	}

	public async go(path: string, options?: RouterGoOptions): Promise<void>;
	public async go<T extends object>(
		path: keyof VirtualRouter<T>,
		options?: RouterGoOptions,
	): Promise<void>;
	public async go(path: string, options?: RouterGoOptions): Promise<void> {
		await this.browser?.go(this.createHref(path, this.layer), options);
	}

	public anchor(path: string): AnchorProps {
		const href = this.createHref(path, this.layer);
		return {
			href,
			onClick: (ev: any) => {
				ev.stopPropagation();
				ev.preventDefault();

				this.go(path).catch(console.error);
			},
		};
	}

	/**
	 * Set query params.
	 *
	 * @param record
	 * @param options
	 */
	public setQueryParams(
		record:
			| Record<string, any>
			| ((queryParams: Record<string, any>) => Record<string, any>),
		options: {
			/**
			 * If true, this will add a new entry to the history stack.
			 */
			push?: boolean;
		} = {},
	) {
		const func = typeof record === "function" ? record : () => record;
		const search = new URLSearchParams(func(this.query)).toString();
		const state = search ? `${this.pathname}?${search}` : this.pathname;

		if (options.push) {
			window.history.pushState({}, "", state);
		} else {
			window.history.replaceState({}, "", state);
		}
	}
}

export type HrefLike = string | { options: { path?: string; name?: string } };

export type VirtualRouter<T> = {
	[K in keyof T as T[K] extends PageDescriptor ? K : never]: T[K];
};
