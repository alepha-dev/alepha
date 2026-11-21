import type { PrimitiveSide } from "alepha";
import { createPrimitive, Primitive } from "alepha";
import { KIND } from "alepha/internal";
import type { ServiceAccountPrimitive } from "alepha/security";
import type { ProxyPrimitiveOptions } from "alepha/server/proxy";

/**
 * $remote is a primitive that allows you to define remote service access.
 *
 * Use it only when you have 2 or more services that need to communicate with each other.
 *
 * All remote services can be exposed as actions, ... or not.
 *
 * You can add a service account if you want to use a security layer: it is
 * the credential of the calls your server makes to the remote on its own
 * behalf, outside any incoming request.
 *
 * ## `$remote` or `$client({ hostname })`?
 *
 * They overlap, and picking the wrong one is the usual mistake.
 *
 * `$remote` is **service-to-service**: declared as a primitive on a class, for
 * an app you also run. It can carry a `$serviceAccount`, and with `proxy` it
 * re-exposes the remote's endpoints through your own server, which is what a
 * backend-for-frontend needs.
 *
 * `$client({ hostname })` is a **consumer** calling an app it does not host - a
 * CLI, a worker, a script. It declares nothing, registers nothing and serves
 * nothing: it resolves against the remote's own `/api/_links` registry and
 * carries whatever credential its scope names.
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
   * import { $env, z } from "alepha";
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
   *
   * Without `proxy`, the remote's actions are for this server's own code:
   * no caller of this server reaches them, by a route, by the registry or by
   * a batched call.
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
   *
   * Its token is sent, as a bearer, when the registry of the remote is read
   * at start, and with a call this server's code makes to the remote outside
   * any incoming request (a job, a hook) when the call names no credential
   * of its own.
   *
   * It is never used while serving a request: there a call forwards the
   * caller's `Authorization`, or goes out without one when the caller has
   * none. A request proxied or batched on behalf of a caller never carries
   * it either.
   */
  serviceAccount?: ServiceAccountPrimitive;
}

export class RemotePrimitive extends Primitive<RemotePrimitiveOptions> {
  /**
   * `boot` for the pure controller rule: read by RemotePrimitiveProvider at
   * `configure`.
   */
  public static override readonly side: PrimitiveSide = "boot";

  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }
}

$remote[KIND] = RemotePrimitive;
