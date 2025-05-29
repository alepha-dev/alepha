import { type Async, OPTIONS, type Static, type TSchema } from "@alepha/core";
import { KIND, NotImplementedError, __descriptor } from "@alepha/core";
import type { FC, ReactNode } from "react";
import type { RouterHookApi } from "../hooks/RouterHookApi.ts";

const KEY = "PAGE";

export interface PageConfigSchema {
	query?: TSchema;
	params?: TSchema;
}

export type TPropsDefault = any;

export type TPropsParentDefault = object;

export interface PageDescriptorOptions<
	TConfig extends PageConfigSchema = PageConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
> {
	name?: string;

	path?: string;

	schema?: TConfig;

	resolve?: (config: PageResolve<TConfig, TPropsParent>) => Async<TProps>;

	component?: FC<TProps & TPropsParent>;

	lazy?: () => Promise<{ default: FC<TProps & TPropsParent> }>;

	children?: Array<{ [OPTIONS]: PageDescriptorOptions }>;

	parent?: { [OPTIONS]: PageDescriptorOptions<any, TPropsParent> };

	can?: () => boolean;

	head?: Head | ((props: TProps, previous?: Head) => Head);

	errorHandler?: (error: Error) => ReactNode;
}

export interface PageDescriptor<
	TConfig extends PageConfigSchema = PageConfigSchema,
	TProps extends object = TPropsDefault,
	TPropsParent extends object = TPropsParentDefault,
> {
	[KIND]: typeof KEY;
	[OPTIONS]: PageDescriptorOptions<TConfig, TProps, TPropsParent>;

	render: (options?: {
		params?: Record<string, string>;
		query?: Record<string, string>;
	}) => Promise<string>;
	go: () => void;
	createAnchorProps: (routerHook: RouterHookApi) => {
		href: string;
		onClick: () => void;
	};
	can: () => boolean;
}

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
		go: () => {
			throw new NotImplementedError(KEY);
		},
		createAnchorProps: () => {
			throw new NotImplementedError(KEY);
		},
		can: () => {
			if (options.can) {
				return options.can();
			}
			return true;
		},
	};
};

$page[KIND] = KEY;

// ---------------------------------------------------------------------------------------------------------------------

export interface Head {
	title?: string;
	titleSeparator?: string;
	htmlAttributes?: Record<string, string>;
	bodyAttributes?: Record<string, string>;
	meta?: Array<{ name: string; content: string }>;
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
> = PageRequestConfig<TConfig> & TPropsParent & PageResolveContext;

export interface PageResolveContext {
	url: URL;
	head: Head;
}
