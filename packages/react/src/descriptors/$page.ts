import type { Async, Static, TSchema } from "@alepha/core";
import { KIND, NotImplementedError, __descriptor } from "@alepha/core";
import type { UserAccountToken } from "@alepha/security";
import type { CookieManager, HttpLink } from "@alepha/server";
import type { FC } from "react";
import type { RouterHookApi } from "../hooks/RouterHookApi";
import {} from "../services/Router";
import type { RouterRenderHeadContext } from "../services/Router";

export const pageDescriptorKey = "PAGE";

export interface PageDescriptorConfigSchema {
	query?: TSchema;
	params?: TSchema;
}
export type TPropsDefault = any;
export type TPropsParentDefault = object;

export interface PageDescriptorOptions<
	TConfig extends PageDescriptorConfigSchema = PageDescriptorConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
> {
	/**
	 *
	 */
	name?: string;

	/**
	 *
	 */
	path?: string;

	/**
	 *
	 */
	schema?: TConfig;

	/**
	 * Function to call when the page is loaded.
	 */
	resolve?: (
		config: PageDescriptorConfigValue<TConfig> &
			TPropsParent & { context: PageContext },
		context: PageContext,
	) => Async<TProps>;

	/**
	 * Component to render when the page is loaded.
	 */
	component?: FC<TProps & TPropsParent>;

	/**
	 * Component to render when the page is loaded. (like .component)
	 */
	lazy?: () => Promise<{ default: FC<TProps & TPropsParent> }>;

	/**
	 *
	 */
	children?: () => Array<{ options: PageDescriptorOptions }>;

	/**
	 *
	 */
	parent?: { options: PageDescriptorOptions<any, TPropsParent> };

	/**
	 *
	 */
	can?: () => boolean;

	/**
	 *
	 */
	head?:
		| RouterRenderHeadContext
		| ((
				props: TProps,
				previous?: RouterRenderHeadContext,
		  ) => RouterRenderHeadContext);

	/**
	 *
	 */
	notFoundHandler?: FC<{ url: string }>;

	/**
	 *
	 */
	errorHandler?: FC<{ error: Error; url: string }>;
}

export interface PageContext {
	user?: UserAccountToken;
	cookies?: CookieManager;
	links?: HttpLink[];
}

export interface PageDescriptorConfigValue<
	TConfig extends PageDescriptorConfigSchema = PageDescriptorConfigSchema,
> {
	query: TConfig["query"] extends TSchema
		? Static<TConfig["query"]>
		: Record<string, string>;
	params: TConfig["params"] extends TSchema
		? Static<TConfig["params"]>
		: Record<string, string>;
	pathname: string;
}

export interface PageDescriptor<
	TConfig extends PageDescriptorConfigSchema = PageDescriptorConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
> {
	[KIND]: typeof pageDescriptorKey;
	render: (options?: {
		params?: Record<string, string>;
		query?: Record<string, string>;
	}) => Promise<string>;
	go: () => void;
	createAnchorProps: (routerHook: RouterHookApi) => {
		href: string;
		onClick: () => void;
	};
	options: PageDescriptorOptions<TConfig, TProps, TPropsParent>;
}

export const $page = <
	TConfig extends PageDescriptorConfigSchema = PageDescriptorConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
>(
	options: PageDescriptorOptions<TConfig, TProps, TPropsParent>,
): PageDescriptor<TConfig, TProps, TPropsParent> => {
	__descriptor(pageDescriptorKey);
	return {
		[KIND]: pageDescriptorKey,
		options,
		render: () => {
			throw new NotImplementedError(pageDescriptorKey);
		},
		go: () => {
			throw new NotImplementedError(pageDescriptorKey);
		},
		createAnchorProps: () => {
			throw new NotImplementedError(pageDescriptorKey);
		},
	};
};

$page[KIND] = pageDescriptorKey;
