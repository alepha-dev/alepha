import type { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { OPTIONS } from "../constants/OPTIONS.ts";
import { createPrimitive, Primitive } from "../helpers/primitive.ts";
import { $context } from "./$context.ts";

/**
 * Creates a pipeline primitive that composes middleware with a handler.
 *
 * It makes a big function which runs all functions (middleware) inside `use` array before and after the `handler` function.
 * The middleware functions are applied in the order they are defined in the `use` array.
 *
 * So PipelinePrimitive is also a base for primitives with `handler` which need some sort of plugins.
 *
 * Use `$pipeline` for standalone composition outside host primitives (`$action`, `$job`, `$page`).
 * Host primitives extend `PipelinePrimitive` directly to get middleware support.
 *
 * ```ts
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
export function $pipeline<T extends (...args: any[]) => any>(
  options: PipelineOptions<T>,
): PipelinePrimitiveFn<T> {
  const instance = createPrimitive(PipelinePrimitive, options);
  const fn = (...args: Parameters<T>): any => instance.run(...args);
  return Object.setPrototypeOf(fn, instance) as PipelinePrimitiveFn<T>;
}

// -----------------------------------------------------------------------------------------------------------------

export class PipelinePrimitive<
  TOptions extends PipelinePrimitiveOptions = PipelinePrimitiveOptions,
> extends Primitive<TOptions> {
  public readonly handler = new PipelineHandler(
    this.options.handler,
    this.options.use,
  );

  public get middlewares(): MiddlewareMetadata[] {
    return (this.options.use ?? []).map(
      (it) => it[OPTIONS] as MiddlewareMetadata,
    );
  }

  /**
   * Execute the wrapped handler.
   */
  public run(...args: any[]): any {
    return this.handler.run(...args);
  }
}

export interface MiddlewareMetadata {
  name: string;
  options?: Record<string, unknown>;

  /**
   * Free-form capability flags describing what this middleware *does*, for
   * consumers that must react to it without knowing which middleware it is.
   *
   * `options` already carries a middleware's configuration, but reading it
   * means knowing whose configuration it is — which is how the router ended up
   * matching on `name === "$secure"`, a string comparison that survives no
   * rename and admits no second implementation. `meta` is the portable half:
   * a middleware declares a capability, and anything may act on the declaration
   * without importing the module that made it.
   *
   * Flat `Record<string, string>` on purpose — serialisable, transport-safe,
   * and cheap to read from a module that shares no types with the writer.
   *
   * See {@link MIDDLEWARE_PROTECTED} for the one key the framework defines.
   * Applications may add their own; unknown keys are ignored.
   */
  meta?: Record<string, string>;
}

export type Middleware = (<T extends (...args: any[]) => any>(
  handler: T,
) => T) & {
  [OPTIONS]?: MiddlewareMetadata;
};

export interface PipelinePrimitiveOptions<
  THandler extends (...args: any[]) => any = (...args: any[]) => any,
> {
  use?: Middleware[];
  handler: THandler;
}

export interface PipelineOptions<
  T extends (...args: any[]) => any = (...args: any[]) => any,
> {
  use: Middleware[];
  handler: T;
}

export interface CreateMiddlewareOptions {
  name: string;
  options?: any;

  /**
   * Capability flags for consumers that must react to what this middleware
   * does without knowing which one it is. See {@link MiddlewareMetadata.meta}.
   */
  meta?: Record<string, string>;
  handler: (context: {
    alepha: Alepha;
    next: (...args: any[]) => any;
  }) => (...args: any[]) => any;
}

/**
 * Internal class that composes middleware and the handler function.
 * This is required when adding more middleware dynamically. See `$middleware()`.
 */
export class PipelineHandler {
  protected fn: (...args: any[]) => any;
  protected middlewares: Middleware[];

  constructor(fn: (...args: any[]) => any, middlewares?: Middleware[]) {
    this.fn = fn;
    this.middlewares = middlewares ?? [];
  }

  protected wrapped?: (...args: any[]) => any;

  public use(...middleware: Middleware[]): void {
    this.middlewares.unshift(...middleware);
    this.wrapped = undefined; // reset wrapped function to apply new middleware
  }

  public run(...args: any[]): any {
    if (!this.wrapped) {
      this.wrapped = this.fn;
      for (let i = this.middlewares.length - 1; i >= 0; i--) {
        this.wrapped = this.middlewares[i](this.wrapped);
      }
    }

    return this.wrapped(...args);
  }
}

// -----------------------------------------------------------------------------------------------------------------

export interface PipelinePrimitiveFn<
  T extends (...args: any[]) => any = (...args: any[]) => any,
> extends PipelinePrimitive<PipelineOptions<T>> {
  (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>>;
}

$pipeline[KIND] = PipelinePrimitive;

// -----------------------------------------------------------------------------------------------------------------

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

  const mw: Middleware = <T extends (...args: any[]) => any>(handler: T): T =>
    config.handler({ alepha, next: handler }) as T;

  mw[OPTIONS] = { name: config.name };

  if (config.options != null) {
    mw[OPTIONS].options = config.options;
  }

  if (config.meta != null) {
    mw[OPTIONS].meta = config.meta;
  }

  return mw;
};
