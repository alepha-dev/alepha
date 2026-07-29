import { createPrimitive, KIND, Primitive } from "alepha";
import type { ServiceAccountPrimitive } from "alepha/security";
import type { ProxyPrimitiveOptions } from "alepha/server/proxy";

/**
 * $remote is a primitive that allows you to define remote service access.
 *
 * Use it only when you have 2 or more services that need to communicate with each other.
 *
 * All remote services can be exposed as actions, ... or not.
 *
 * You can add a service account if you want to use a security layer.
 */
export const $remote = (options: RemotePrimitiveOptions) => {
  return createPrimitive(RemotePrimitive, options);
};

export interface RemotePrimitiveOptions {
  /**
   * The URL of the remote service.
   * You can use a function to generate the URL dynamically.
   * You probably should use $env(env) to get the URL from the environment.
   *
   * @example
   * ```ts
   * import { $remote } from "alepha/server/links";
   * import { $inject, z } from "alepha";
   *
   * class App {
   *   env = $env(z.object({
   *     REMOTE_URL: z.text({default: "http://localhost:3000"}),
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
        ProxyPrimitiveOptions & {
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
  serviceAccount?: ServiceAccountPrimitive;
}

export class RemotePrimitive extends Primitive<RemotePrimitiveOptions> {
  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }
}

$remote[KIND] = RemotePrimitive;
