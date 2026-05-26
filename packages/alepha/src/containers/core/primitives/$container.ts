import { $inject, AlephaError, createPrimitive, KIND, Primitive } from "alepha";
import type { ContainerPrimitiveOptions } from "../interfaces/ContainerOptions.ts";
import { ContainerProvider } from "../providers/ContainerProvider.ts";

/**
 * `$container` — typed RPC client to a containerized Alepha app.
 *
 * Returns a typed Proxy whose method calls map 1:1 to the target
 * controller's `$action` endpoints. The wire format mirrors what a
 * normal Alepha server exposes (`POST /api/<method>` with a JSON body),
 * so the container is literally a tiny Alepha worker.
 *
 * Transport is owned by the active {@link ContainerProvider}:
 * - `target=cloudflare` → `CloudflareContainerProvider` routes through
 *   the Containers binding (`env.<NAME>.getContainer(...).fetch()`).
 * - Node (with `url` set) → `NodeContainerProvider` uses plain
 *   `fetch()` against the configured URL.
 *
 * Build-time, `BuildCloudflareTask.enhanceContainers` walks
 * `alepha.primitives($container)` to emit the matching `wrangler.jsonc`
 * entries and Durable Object class declarations into
 * `main.cloudflare.js`.
 *
 * @example
 * ```ts
 * import { $container } from "alepha/containers";
 * import type { RocketController } from "@alepha/rocket";
 *
 * class DeployService {
 *   rocket = $container<RocketController>({
 *     image: "alepha/rocket:latest",
 *     port: 3000,
 *     sleepAfter: "15m",
 *   });
 *
 *   async deploy() {
 *     return this.rocket.createJob({ body: { op: "up" } });
 *   }
 * }
 * ```
 */
export const $container = <T extends object = any>(
  options: ContainerPrimitiveOptions,
): ContainerProxy<T> => {
  if (!options.image) {
    throw new AlephaError("$container requires an 'image' option");
  }
  const instance = createPrimitive(ContainerPrimitive, options);
  return instance.proxy() as ContainerProxy<T>;
};

/**
 * Typed proxy returned by `$container<T>()`. Each `$action` member of
 * `T` becomes a callable returning the action's response body.
 *
 * The runtime shape is a `Proxy(primitive)` — own-property reads hit the
 * underlying `ContainerPrimitive` (so `alepha.primitives($container)`
 * still finds it via the `instanceof Primitive` check inside
 * `Alepha.new()`), and anything else is treated as an action name and
 * routed through the active `ContainerProvider`.
 */
export type ContainerProxy<T extends object> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : (config?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      }) => Promise<any>;
};

export class ContainerPrimitive extends Primitive<ContainerPrimitiveOptions> {
  protected readonly provider = $inject(ContainerProvider);

  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  /**
   * Build the typed Proxy. The target is the primitive itself so
   * `instanceof Primitive` keeps working (required by Alepha's
   * primitive registration in `Alepha.new`). Property reads that match
   * an own/inherited member return that member; anything else is
   * treated as an action name and routed through the provider.
   */
  public proxy<T extends object = any>(): ContainerProxy<T> {
    const primitive = this;
    return new Proxy(primitive as any, {
      get(target: any, prop: string | symbol, receiver: any) {
        if (typeof prop === "symbol" || prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        return (config: any = {}) =>
          primitive.provider.invoke(primitive, prop as string, config);
      },
    }) as ContainerProxy<T>;
  }
}

$container[KIND] = ContainerPrimitive;
