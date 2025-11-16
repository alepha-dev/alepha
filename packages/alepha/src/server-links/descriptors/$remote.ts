import { createDescriptor, Descriptor, KIND } from "alepha";
import type { ServiceAccountDescriptor } from "alepha/security";
import type { ProxyDescriptorOptions } from "alepha/server/proxy";

/**
 * $remote is a descriptor that allows you to define remote service access.
 *
 * Use it only when you have 2 or more services that need to communicate with each other.
 *
 * All remote services can be exposed as actions, ... or not.
 *
 * You can add a service account if you want to use a security layer.
 */
export const $remote = (options: RemoteDescriptorOptions) => {
  return createDescriptor(RemoteDescriptor, options);
};

export interface RemoteDescriptorOptions {
  /**
   * The URL of the remote service.
   * You can use a function to generate the URL dynamically.
   * You probably should use $env(env) to get the URL from the environment.
   *
   * @example
   * ```ts
   * import { $remote } from "alepha/server";
   * import { $inject, t } from "alepha";
   *
   * class App {
   *   env = $env(t.object({
   *     REMOTE_URL: t.text({default: "http://localhost:3000"}),
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

export class RemoteDescriptor extends Descriptor<RemoteDescriptorOptions> {
  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }
}

$remote[KIND] = RemoteDescriptor;
