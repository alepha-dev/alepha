import { $inject, Alepha } from "@alepha/core";
import type { PageDescriptor } from "../descriptors/$page.ts";
import {
	ReactBrowserProvider,
	type RouterGoOptions,
} from "../providers/ReactBrowserProvider.ts";
import {
	type AnchorProps,
	ReactPageProvider,
	type ReactRouterState,
} from "../providers/ReactPageProvider.ts";

export class ReactRouter<T extends object> {
	protected readonly alepha = $inject(Alepha);
	protected readonly pageApi = $inject(ReactPageProvider);

	public get state(): ReactRouterState {
		return this.alepha.state("react.router.state")!;
	}

	public get pages() {
		return this.pageApi.getPages();
	}

	public get browser(): ReactBrowserProvider | undefined {
		if (this.alepha.isBrowser()) {
			return this.alepha.inject(ReactBrowserProvider);
		}
		// server-side
		return undefined;
	}

	public path(
		name: keyof VirtualRouter<T>,
		config: {
			params?: Record<string, string>;
			query?: Record<string, string>;
		} = {},
	): string {
		return this.pageApi.pathname(name as string, {
			params: {
				...this.state.params,
				...config.params,
			},
			query: config.query,
		});
	}

	public getURL(): URL {
		if (!this.browser) {
			return this.state.url;
		}

		return new URL(this.location.href);
	}

	public get location(): Location {
		if (!this.browser) {
			throw new Error("Browser is required");
		}

		return this.browser.location;
	}

	public get current(): ReactRouterState {
		return this.state;
	}

	public get pathname(): string {
		return this.state.url.pathname;
	}

	public get query(): Record<string, string> {
		const query: Record<string, string> = {};

		for (const [key, value] of new URLSearchParams(
			this.state.url.search,
		).entries()) {
			query[key] = String(value);
		}

		return query;
	}

	public async back() {
		this.browser?.history.back();
	}

	public async forward() {
		this.browser?.history.forward();
	}

	public async invalidate(props?: Record<string, any>) {
		await this.browser?.invalidate(props);
	}

	public async go(path: string, options?: RouterGoOptions): Promise<void>;
	public async go(
		path: keyof VirtualRouter<T>,
		options?: RouterGoOptions,
	): Promise<void>;
	public async go(
		path: string | keyof VirtualRouter<T>,
		options?: RouterGoOptions,
	): Promise<void> {
		for (const page of this.pages) {
			if (page.name === path) {
				await this.browser?.go(
					this.path(path as keyof VirtualRouter<T>, options),
					options,
				);
				return;
			}
		}

		await this.browser?.go(path as string, options);
	}

	public anchor(
		path: string,
		options?: { params?: Record<string, any> },
	): AnchorProps;
	public anchor(
		path: keyof VirtualRouter<T>,
		options?: { params?: Record<string, any> },
	): AnchorProps;
	public anchor(
		path: string | keyof VirtualRouter<T>,
		options: { params?: Record<string, any> } = {},
	): AnchorProps {
		let href = path as string;

		for (const page of this.pages) {
			if (page.name === path) {
				href = this.path(path as keyof VirtualRouter<T>, options);
				break;
			}
		}

		return {
			href: this.base(href),
			onClick: (ev: any) => {
				ev.stopPropagation();
				ev.preventDefault();

				this.go(href, options).catch(console.error);
			},
		};
	}

	public base(path: string): string {
		const base = import.meta.env?.BASE_URL;
		if (!base || base === "/") {
			return "";
		}

		return base + path;
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

export type VirtualRouter<T> = {
	[K in keyof T as T[K] extends PageDescriptor ? K : never]: T[K];
};
