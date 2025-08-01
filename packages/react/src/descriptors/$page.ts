import {
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
import type { PageReactContext } from "../providers/PageDescriptorProvider.ts";

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

	errorHandler?: (error: Error) => ReactNode;

	/**
	 * If true, the page will be rendered on the build time.
	 * Works only with viteAlepha plugin.
	 *
	 * Replace boolean by an object to define static entries. (e.g. list of params/query)
	 */
	static?:
		| boolean
		| {
				entries?: Array<Partial<PageRequestConfig<TConfig>>>;
		  };

	/**
	 * If true, the page will be rendered on the client-side.
	 */
	client?: boolean | ClientOnlyProps;

	afterHandler?: (request: ServerRequest) => any;

	cache?: ServerRouteCache;
}

export class PageDescriptor<
	TConfig extends PageConfigSchema = PageConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
> extends Descriptor<PageDescriptorOptions<TConfig, TProps, TPropsParent>> {
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
		throw new Error("render method is not implemented in this environment");
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
	html?: boolean;
	hydration?: boolean;
}

export interface PageDescriptorRenderResult {
	html: string;
	context: PageReactContext;
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
