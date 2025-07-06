import { __descriptor, KIND, OPTIONS } from "@alepha/core";
import type { ServiceAccountDescriptor } from "@alepha/security";
import type { ProxyDescriptorOptions } from "@alepha/server-proxy";

const KEY = "REMOTE";

export interface RemoteDescriptorOptions {
	/**
	 * The URL of the remote service.
	 * You can use a function to generate the URL dynamically.
	 * You probably should use $inject(env) to get the URL from the environment.
	 *
	 * @example
	 * ```ts
	 * import { $remote } from "@alepha/server";
	 * import { $inject, t } from "@alepha/core";
	 *
	 * class App {
	 *   env = $inject(t.object({
	 *     REMOTE_URL: t.string({default: "http://localhost:3000"}),
	 *   }));
	 *   remote = $remote({
	 *     url: this.env.REMOTE_URL,
	 *   });
	 * }
	 * ```
	 */
	url: string | (() => string);

	/**
	 * The name of the remote service.
	 *
	 * @default Member of the class containing the remote service.
	 */
	name?: string;

	/**
	 * If true, all methods of the remote service will be exposed as actions in this context.
	 * > Note: Proxy will never use the service account, it just... proxies the request.
	 */
	proxy?:
		| boolean
		| Partial<
				ProxyDescriptorOptions & {
					/**
					 * If true, the remote service won't be available internally, only through the proxy.
					 */
					noInternal: boolean;
				}
		  >;

	/**
	 * For communication between the server and the remote service with a security layer.
	 * This will be used for internal communication and will not be exposed to the client.
	 */
	serviceAccount?: ServiceAccountDescriptor;
}

export interface RemoteDescriptor {
	[KIND]: typeof KEY;
	[OPTIONS]: RemoteDescriptorOptions;
}

/**
 * $remote is a descriptor that allows you to define a remote service access.
 *
 * Use it only when you have 2 or more services that need to communicate with each other.
 *
 * All remote services can be exposed as actions, ... or not.
 *
 * You can add a service account if you want to use a security layer.
 */
export const $remote = (options: RemoteDescriptorOptions) => {
	__descriptor(KEY);
	return {
		[KIND]: KEY,
		[OPTIONS]: options,
	} as RemoteDescriptor;
};

$remote[KIND] = KEY;
