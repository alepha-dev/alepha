// import { randomUUID } from "node:crypto";
// import {
// 	$env,
// 	$hook,
// 	$inject,
// 	$logger,
// 	Alepha,
// 	isFileLike,
// 	isTypeFile,
// 	KIND,
// 	OPTIONS,
// 	type Static,
// 	t,
// } from "@alepha/core";
// import {
// 	type Permission,
// 	SecurityProvider,
// 	type ServiceAccountDescriptor,
// 	type UserAccountToken,
// } from "@alepha/security";
// import type { RouteMethod } from "../constants/routeMethods.ts";
// import {
// 	$action,
// 	type ActionDescriptor,
// 	type ActionDescriptorOptions,
// 	type ClientRequestEntry,
// 	type ClientRequestOptions,
// } from "../descriptors/$action.ts";
// import { ForbiddenError } from "../errors/ForbiddenError.ts";
// import { UnauthorizedError } from "../errors/UnauthorizedError.ts";
// import { ActionDescriptorHelper } from "../helpers/ActionDescriptorHelper.ts";
// import { ServerReply } from "../helpers/ServerReply.ts";
// import type {
// 	RequestConfigSchema,
// 	ServerRequest,
// 	ServerRequestConfigEntry,
// 	ServerRoute,
// } from "../interfaces/index.ts";
// import type { ApiLinksResponse } from "../schemas/apiLinksResponseSchema.ts";
// import { HttpClient } from "../services/HttpClient.ts";
// import { ServerProvider } from "./platforms/ServerProvider.ts";
// import { ServerRouterProvider } from "./ServerRouterProvider.ts";
//
// const envSchema = t.object({
// 	SERVER_API_PREFIX: t.string({
// 		description: "Prefix for all API routes (e.g. $action).",
// 		default: "/api",
// 	}),
// 	SERVER_SECURITY_ENABLED: t.boolean({
// 		description: "Enable security for all endpoints by default.",
// 		default: false,
// 	}),
// });
//
// declare module "@alepha/core" {
// 	interface Env extends Partial<Static<typeof envSchema>> {}
//
// 	interface State {
// 		/**
// 		 * Real (or fake) user account, used for internal actions.
// 		 * If you define this, you assume that all actions are executed by this user by default.
// 		 * And to force a different user, you need to pass it explicitly in the options.
// 		 */
// 		"ServerSecurityProvider.localSystemUser"?: UserAccountToken;
// 	}
// }
//
// export class ServerActionDescriptorProvider {
// 	protected readonly log = $logger();
// 	protected readonly alepha = $inject(Alepha);
// 	protected readonly env = $env(envSchema);
//
// 	protected readonly helper = $inject(ActionDescriptorHelper);
//
// 	protected readonly client = $inject(HttpClient);
// 	protected readonly serverProvider = $inject(ServerProvider);
// 	protected readonly routerProvider = $inject(ServerRouterProvider);
// 	protected readonly actions: ServerRouteAction[] = [];
//
// 	public getActions() {
// 		return this.actions;
// 	}
//
// 	public getPrefix() {
// 		return this.env.SERVER_API_PREFIX;
// 	}
//
// 	public async registerAction(
// 		value: ActionDescriptor,
// 		key: string,
// 		instance: any,
// 		prefix = this.env.SERVER_API_PREFIX,
// 	) {
// 		const options = value[OPTIONS] as ActionDescriptorOptions;
// 		const path = this.helper.path(options, instance, key);
//
// 		if (options.disabled) {
// 			this.log.trace(`'${instance.constructor.name}#${key}' is disabled`);
// 			return;
// 		}
//
// 		if (!options.handler) {
// 			this.log.warn(
// 				`No handler found for the route ${instance.constructor.name}#${key}`,
// 			);
// 			return;
// 		}
//
// 		const permission = this.helper.permission(options, instance, key);
// 		const action: ServerRouteAction = {
// 			...options,
// 			prefix,
// 			method: this.helper.method(options),
// 			path,
// 			name: this.helper.name(options, instance, key),
// 			group: this.helper.group(options, instance),
// 			permission: this.helper.permission(options, instance, key),
// 			schema: options.schema,
// 			handler: options.handler,
// 			options,
// 			localHandler: this.createLocalHandler(options, permission),
// 		};
//
// 		this.actions.push(action);
//
// 		// --- Routing
//
// 		await this.routerProvider.createRoute({
// 			...action,
// 			handler: options.handler,
// 			path: `${action.prefix}${action.path}`,
// 		});
//
// 		// --- Log
//
// 		this.log.debug(
// 			`+ '${action.method} ${action.path}' -> ${instance.constructor.name}#${key}`,
// 		);
//
// 		// --- Descriptor $action
//
// 		const $ = (
// 			config: Partial<ClientRequestEntry> = {},
// 			opts: ClientRequestOptions = {},
// 		) => action.localHandler(config, opts);
//
// 		$[KIND] = "ACTION";
// 		$[OPTIONS] = action.options;
// 		$.fetch = (
// 			config: Partial<ClientRequestEntry> = {},
// 			options: ClientRequestOptions = {},
// 		) => {
// 			return this.client.fetchAction({
// 				action,
// 				host: this.serverProvider.hostname,
// 				config,
// 				options,
// 			});
// 		};
// 		$.permission = () => action.permission;
//
// 		instance[key] = $;
// 	}
// }
//
// // ----------------------------------------------------------------------------------------------------------
//
// export const isServerAction = (value: any): value is ServerRouteAction => {
// 	return (
// 		typeof value === "object" &&
// 		typeof value.name === "string" &&
// 		typeof value.group === "string"
// 	);
// };
//
// // ----------------------------------------------------------------------------------------------------------
//
// export interface ServerRemote {
// 	url: string;
// 	name: string;
// 	proxy: boolean;
// 	internal: boolean;
// 	links: (args: { authorization?: string }) => Promise<ApiLinksResponse>;
// 	schema: (args: { name: string; authorization?: string }) => Promise<any>;
// 	serviceAccount?: ServiceAccountDescriptor;
// 	prefix: string;
// }
