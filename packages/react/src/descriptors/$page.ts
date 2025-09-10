import {
	AlephaError,
	type Async,
	createDescriptor,
	Descriptor,
	KIND,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { ServerRequest } from "@alepha/server";
import type { ServerRouteCache } from "@alepha/server-cache";
import type { FC, ReactNode } from "react";
import type { ClientOnlyProps } from "../components/ClientOnly.tsx";
import type { Redirection } from "../errors/Redirection.ts";
import type { ReactRouterState } from "../providers/ReactPageProvider.ts";

/**
 * Main descriptor for defining a React route in the application.
 */
export const $page = <
	TConfig extends PageConfigSchema = PageConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
>(
	options: PageDescriptorOptions<TConfig, TProps, TPropsParent>,
): PageDescriptor<TConfig, TProps, TPropsParent> => {
	return createDescriptor(
		PageDescriptor<TConfig, TProps, TPropsParent>,
		options,
	);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface PageDescriptorOptions<
	TConfig extends PageConfigSchema = PageConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
> {
	/**
	 * Name your page.
	 *
	 * @default Descriptor key
	 */
	name?: string;

	/**
	 * Optional description of the page.
	 */
	description?: string;

	/**
	 * Add a pathname to the page.
	 *
	 * Pathname can contain parameters, like `/post/:slug`.
	 *
	 * @default ""
	 */
	path?: string;

	/**
	 * Add an input schema to define:
	 * - `params`: parameters from the pathname.
	 * - `query`: query parameters from the URL.
	 */
	schema?: TConfig;

	/**
	 * Load data before rendering the page.
	 *
	 * This function receives
	 * - the request context and
	 * - the parent props (if page has a parent)
	 *
	 * In SSR, the returned data will be serialized and sent to the client, then reused during the client-side hydration.
	 *
	 * Resolve can be stopped by throwing an error, which will be handled by the `errorHandler` function.
	 * It's common to throw a `NotFoundError` to display a 404 page.
	 *
	 * RedirectError can be thrown to redirect the user to another page.
	 */
	resolve?: (context: PageResolve<TConfig, TPropsParent>) => Async<TProps>;

	/**
	 * The component to render when the page is loaded.
	 *
	 * If `lazy` is defined, this will be ignored.
	 * Prefer using `lazy` to improve the initial loading time.
	 */
	component?: FC<TProps & TPropsParent>;

	/**
	 * Lazy load the component when the page is loaded.
	 *
	 * It's recommended to use this for components to improve the initial loading time
	 * and enable code-splitting.
	 */
	lazy?: () => Promise<{ default: FC<TProps & TPropsParent> }>;

	/**
	 * Set some children pages and make the page a parent page.
	 *
	 * /!\ Parent page can't be rendered directly. /!\
	 *
	 * If you still want to render at this pathname, add a child page with an empty path.
	 */
	children?: Array<PageDescriptor> | (() => Array<PageDescriptor>);

	parent?: PageDescriptor<PageConfigSchema, TPropsParent>;

	can?: () => boolean;

	/**
	 * Catch any error from the `resolve` function or during `rendering`.
	 *
	 * Expected to return one of the following:
	 * - a ReactNode to render an error page
	 * - a Redirection to redirect the user
	 * - undefined to let the error propagate
	 *
	 * If not defined, the error will be thrown and handled by the server or client error handler.
	 * If a leaf $page does not define an error handler, the error can be caught by parent pages.
	 *
	 * @example Catch a 404 from API and render a custom not found component:
	 * ```ts
	 * resolve: async ({ params, query }) => {
	 *    api.fetch("/api/resource", { params, query });
	 * },
	 * errorHandler: (error, context) => {
	 *   if (HttpError.is(error, 404)) {
	 *     return <ResourceNotFound />;
	 *   }
	 * }
	 * ```
	 *
	 * @example Catch an 401 error and redirect the user to the login page:
	 * ```ts
	 * resolve: async ({ params, query }) => {
	 *   // but the user is not authenticated
	 *   api.fetch("/api/resource", { params, query });
	 * },
	 * errorHandler: (error, context) => {
	 *   if (HttpError.is(error, 401)) {
	 *     // throwing a Redirection is also valid!
	 *     return new Redirection("/login");
	 *   }
	 * }
	 * ```
	 */
	errorHandler?: ErrorHandler;

	/**
	 * If true, the page will be considered as a static page, immutable and cacheable.
	 * Replace boolean by an object to define static entries. (e.g. list of params/query)
	 *
	 * For now, it only works with `@alepha/vite` which can pre-render the page at build time.
	 *
	 * It will act as timeless cached page server-side. You can use `cache` to configure the cache behavior.
	 */
	static?:
		| boolean
		| {
				entries?: Array<Partial<PageRequestConfig<TConfig>>>;
		  };

	cache?: ServerRouteCache;

	/**
	 * If true, force the page to be rendered only on the client-side.
	 * It uses the `<ClientOnly/>` component to render the page.
	 */
	client?: boolean | ClientOnlyProps;

	/**
	 * Called before the server response is sent to the client.
	 */
	onServerResponse?: (request: ServerRequest) => any;

	/**
	 * Called when user leaves the page. (browser only)
	 */
	onLeave?: () => void;

	/**
	 * @experimental
	 *
	 * Add a css animation when the page is loaded or unloaded.
	 * It uses CSS animations, so you need to define the keyframes in your CSS.
	 *
	 * @example Simple animation name
	 * ```ts
	 * animation: "fadeIn"
	 * ```
	 *
	 * CSS example:
	 * ```css
	 * @keyframes fadeIn {
	 *  from { opacity: 0; }
	 *  to { opacity: 1; }
	 * }
	 * ```
	 *
	 * @example Detailed animation
	 * ```ts
	 * animation: {
	 *   enter: { name: "fadeIn", duration: 300 },
	 *   exit: { name: "fadeOut", duration: 200, timing: "ease-in-out" },
	 * }
	 * ```
	 *
	 * @example Only exit animation
	 * ```ts
	 * animation: {
	 *   exit: "fadeOut"
	 * }
	 * ```
	 *
	 * @example With custom timing function
	 * ```ts
	 * animation: {
	 *   enter: { name: "fadeIn", duration: 300, timing: "cubic-bezier(0.4, 0, 0.2, 1)" },
	 *   exit: { name: "fadeOut", duration: 200, timing: "ease-in-out" },
	 * }
	 * ```
	 */
	animation?: PageAnimation;
}

export type ErrorHandler = (
	error: Error,
	state: ReactRouterState,
) => ReactNode | Redirection | undefined;

export class PageDescriptor<
	TConfig extends PageConfigSchema = PageConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
> extends Descriptor<PageDescriptorOptions<TConfig, TProps, TPropsParent>> {
	protected onInit() {
		if (this.options.static) {
			this.options.cache ??= {
				provider: "memory",
				ttl: [1, "week"],
			};
		}
	}

	public get name(): string {
		return this.options.name ?? this.config.propertyKey;
	}

	/**
	 * For testing or build purposes, this will render the page (with or without the HTML layout) and return the HTML and context.
	 * Only valid for server-side rendering, it will throw an error if called on the client-side.
	 */
	public async render(
		options?: PageDescriptorRenderOptions,
	): Promise<PageDescriptorRenderResult> {
		throw new AlephaError(
			"render() method is not implemented in this environment",
		);
	}

	public async fetch(options?: PageDescriptorRenderOptions): Promise<{
		html: string;
		response: Response;
	}> {
		throw new AlephaError(
			"fetch() method is not implemented in this environment",
		);
	}

	public match(url: string): boolean {
		// TODO: Implement a way to match the URL against the pathname
		return false;
	}

	public pathname(config: any) {
		// TODO: Implement a way to generate the pathname based on the config
		return this.options.path || "";
	}
}

$page[KIND] = PageDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface PageConfigSchema {
	query?: TSchema;
	params?: TSchema;
}

export type TPropsDefault = any;

export type TPropsParentDefault = {};

export interface PageDescriptorRenderOptions {
	params?: Record<string, string>;
	query?: Record<string, string>;

	/**
	 * If true, the HTML layout will be included in the response.
	 * If false, only the page content will be returned.
	 *
	 * @default true
	 */
	html?: boolean;
	hydration?: boolean;
}

export interface PageDescriptorRenderResult {
	html: string;
	state: ReactRouterState;
	redirect?: string;
}

export interface PageRequestConfig<
	TConfig extends PageConfigSchema = PageConfigSchema,
> {
	params: TConfig["params"] extends TSchema
		? Static<TConfig["params"]>
		: Record<string, string>;

	query: TConfig["query"] extends TSchema
		? Static<TConfig["query"]>
		: Record<string, string>;
}

export type PageResolve<
	TConfig extends PageConfigSchema = PageConfigSchema,
	TPropsParent extends object = TPropsParentDefault,
> = PageRequestConfig<TConfig> &
	TPropsParent &
	Omit<ReactRouterState, "layers" | "onError">;

export type PageAnimation =
	| PageAnimationObject
	| ((state: ReactRouterState) => PageAnimationObject | undefined);

type PageAnimationObject =
	| CssAnimationName
	| {
			enter?: CssAnimation | CssAnimationName;
			exit?: CssAnimation | CssAnimationName;
	  };

type CssAnimationName = string;

type CssAnimation = {
	name: string;
	duration?: number;
	timing?: string;
};
