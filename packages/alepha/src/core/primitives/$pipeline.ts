import type { Alepha } from "../Alepha.ts";
import { $context } from "./$context.ts";

/**
 * Metadata attached to middleware functions for introspection (devtools, logging, debugging).
 */
export interface MiddlewareMetadata {
  name: string;
  options?: Record<string, unknown>;
}

/**
 * A middleware wraps a handler function, adding behavior before, after, or around the call.
 */
export type Middleware = <T extends (...args: any[]) => any>(handler: T) => T;

export interface PipelineOptions<T extends (...args: any[]) => any> {
  use?: Middleware[];
  handler: T;
}

export interface CreateMiddlewareOptions {
  name: string;
  options?: Record<string, unknown>;
  handler: (context: {
    alepha: Alepha;
    next: (...args: any[]) => any;
  }) => (...args: any[]) => any;
}

/**
 * Creates a middleware with automatic `$context()` resolution, type handling, and metadata.
 *
 * Eliminates the boilerplate of calling `$context()`, casting types, and attaching
 * `MiddlewareMetadata`. The handler receives `{ alepha, next }` and returns the
 * wrapped function directly.
 *
 * ```typescript
 * export const $logElastic = (options?: LogOptions): Middleware => {
 *   return createMiddleware({
 *     name: "$logElastic",
 *     options,
 *     handler: ({ alepha, next }) => {
 *       const elastic = alepha.inject(ElasticProvider);
 *       return async (...args) => {
 *         const result = await next(...args);
 *         elastic.push({ ... }).catch(() => {});
 *         return result;
 *       };
 *     },
 *   });
 * };
 * ```
 */
export const createMiddleware = (
  config: CreateMiddlewareOptions,
): Middleware => {
  const { alepha } = $context();

  const mw: any = <T extends (...args: any[]) => any>(handler: T): T =>
    config.handler({ alepha, next: handler }) as T;

  mw.middleware =
    config.options != null
      ? { name: config.name, options: config.options }
      : { name: config.name };

  return mw;
};

/**
 * Composes middleware with a handler and returns the wrapped function.
 *
 * Middleware is applied right-to-left so that the first entry in the array is the outermost
 * wrapper (runs first). The last entry is closest to the handler.
 *
 * ```
 * use: [$a, $b, $c]
 * // Applied as: a(b(c(handler)))
 * // Execution order: a → b → c → handler → c → b → a
 * ```
 *
 * Use `$pipeline` for standalone composition outside host primitives (`$action`, `$job`, `$page`).
 * Host primitives also use `$pipeline` internally to apply their `use` array.
 *
 * ```typescript
 * class OrderService {
 *   processOrder = $pipeline({
 *     use: [$lock({ name: "process-order" }), $retry({ max: 3 })],
 *     handler: async (orderId: string) => {
 *       return await this.orders.updateById(orderId, { status: "paid" });
 *     },
 *   });
 * }
 * ```
 */
export function $pipeline<T extends (...args: any[]) => any>(options: {
  handler: T;
  use?: never;
}): T;
export function $pipeline<T extends (...args: any[]) => any>(options: {
  use: Middleware[];
  handler: T;
}): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>;
export function $pipeline<T extends (...args: any[]) => any>(options: {
  use?: Middleware[];
  handler: T;
}): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>;
export function $pipeline<T extends (...args: any[]) => any>(
  options: PipelineOptions<T>,
): any {
  const middlewares = options.use;
  if (!middlewares?.length) return options.handler;

  let wrapped = options.handler;
  for (let i = middlewares.length - 1; i >= 0; i--) {
    wrapped = middlewares[i](wrapped) as T;
  }

  (wrapped as any).__middlewares = middlewares
    .map((mw) => (mw as any).middleware as MiddlewareMetadata | undefined)
    .filter(Boolean);

  return wrapped;
}
