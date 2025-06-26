import {
	__descriptor,
	type Async,
	KIND,
	NotImplementedError,
	OPTIONS,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { ServerRequest, ServerRoute } from "@alepha/server";
import type { FC, ReactNode } from "react";
import type { ClientOnlyProps } from "../components/ClientOnly.tsx";
import type { PageReactContext } from "../providers/PageDescriptorProvider.ts";

const KEY = "PAGE";

export interface PageConfigSchema {
	query?: TSchema;
	params?: TSchema;
}

export type TPropsDefault = any;

export type TPropsParentDefault = {};

export interface PageDescriptorOptions<
	TConfig extends PageConfigSchema = PageConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
> extends Pick<ServerRoute, "cache"> {
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
	children?: Array<{ [OPTIONS]: PageDescriptorOptions }>;

	parent?: { [OPTIONS]: PageDescriptorOptions<PageConfigSchema, TPropsParent> };

	can?: () => boolean;

	head?: Head | ((props: TProps, previous?: Head) => Head);

	errorHandler?: (error: Error) => ReactNode;

	prerender?:
		| boolean
		| {
				entries?: Array<Partial<PageRequestConfig<TConfig>>>;
		  };

	/**
	 * If true, the page will be rendered on the client-side.
	 */
	client?: boolean | ClientOnlyProps;

	afterHandler?: (request: ServerRequest) => any;
}

export interface PageDescriptor<
	TConfig extends PageConfigSchema = PageConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
> {
	[KIND]: typeof KEY;
	[OPTIONS]: PageDescriptorOptions<TConfig, TProps, TPropsParent>;

	/**
	 * For testing or build purposes, this will render the page (with or without the HTML layout) and return the HTML and context.
	 * Only valid for server-side rendering, it will throw an error if called on the client-side.
	 */
	render: (
		options?: PageDescriptorRenderOptions,
	) => Promise<PageDescriptorRenderResult>;
}

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
	__descriptor(KEY);

	if (options.children) {
		for (const child of options.children) {
			child[OPTIONS].parent = {
				[OPTIONS]: options as PageDescriptorOptions<any, any, any>,
			};
		}
	}

	if (options.parent) {
		options.parent[OPTIONS].children ??= [];
		options.parent[OPTIONS].children.push({
			[OPTIONS]: options as PageDescriptorOptions<any, any, any>,
		});
	}

	return {
		[KIND]: KEY,
		[OPTIONS]: options,
		render: () => {
			throw new NotImplementedError(KEY);
		},
	};
};

$page[KIND] = KEY;

// ---------------------------------------------------------------------------------------------------------------------

export interface PageDescriptorRenderOptions {
	params?: Record<string, string>;
	query?: Record<string, string>;
	withLayout?: boolean;
}

export interface PageDescriptorRenderResult {
	html: string;
	context: PageReactContext;
}

export interface Head {
	title?: string;
	description?: string;
	titleSeparator?: string;
	htmlAttributes?: Record<string, string>;
	bodyAttributes?: Record<string, string>;
	meta?: Array<{ name: string; content: string }>;

	// TODO
	keywords?: string[];
	author?: string;
	robots?: string;
	themeColor?: string;
	viewport?:
		| string
		| {
				width?: string;
				height?: string;
				initialScale?: string;
				maximumScale?: string;
				userScalable?: "no" | "yes" | "0" | "1";
				interactiveWidget?:
					| "resizes-visual"
					| "resizes-content"
					| "overlays-content";
		  };

	og?: {
		title?: string;
		description?: string;
		image?: string;
		url?: string;
		type?: string;
	};

	twitter?: {
		card?: string;
		title?: string;
		description?: string;
		image?: string;
		site?: string;
	};
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
> = PageRequestConfig<TConfig> & TPropsParent & PageReactContext;
