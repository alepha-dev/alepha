import {
  $context,
  $inject,
  createMiddleware,
  type Middleware,
  Primitive,
  type PrimitiveArgs,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import type { RetryBackoffOptions } from "../providers/RetryProvider.ts";
import { RetryProvider } from "../providers/RetryProvider.ts";

/**
 * Retry middleware for `use` arrays in `$action`, `$job`, `$page`, `$pipeline`.
 *
 * Retries the handler on failure with configurable backoff, max attempts, and
 * conditional retry via `when`. Aborts on application shutdown.
 *
 * ```ts
 * processOrder = $action({
 *   use: [$retry({ max: 3, backoff: { initial: 500 } })],
 *   handler: async ({ body }) => { ... },
 * });
 * ```
 */
export const $retry = (options?: RetryMiddlewareOptions): Middleware => {
  const { alepha } = $context();
  const retryProvider = alepha.inject(RetryProvider);
  let appAbortController: AbortController | undefined;

  alepha.events.on("stop", () => {
    appAbortController?.abort();
    // Cleared, not just aborted: `??=` below would keep reusing an aborted
    // controller after a stop→start cycle, and every retry would throw
    // RetryCancelError immediately for the rest of the process. In-flight
    // retries already hold the signal, so they still see the abort.
    appAbortController = undefined;
  });

  return createMiddleware({
    name: "$retry",
    options: options as unknown as Record<string, unknown>,
    handler: ({ next }) => {
      return async (...args) => {
        appAbortController ??= new AbortController();
        return retryProvider.retry(
          {
            ...options,
            handler: next,
            additionalSignal: appAbortController.signal,
          },
          ...args,
        );
      };
    },
  });
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RetryPrimitiveOptions<T extends (...args: any[]) => any> {
  /**
   * The function to retry.
   */
  handler: T;

  /**
   * The maximum number of attempts.
   *
   * @default 3
   */
  max?: number;

  /**
   * The backoff strategy for delays between retries.
   * Can be a fixed number (in ms) or a configuration object for exponential backoff.
   *
   * @default { initial: 200, factor: 2, jitter: true }
   */
  backoff?: number | RetryBackoffOptions;

  /**
   * An overall time limit for all retry attempts combined.
   *
   * e.g., `[5, 'seconds']`
   */
  maxDuration?: DurationLike;

  /**
   * A function that determines if a retry should be attempted based on the error.
   *
   * @default (error) => true (retries on any error)
   */
  when?: (error: Error) => boolean;

  /**
   * A custom callback for when a retry attempt fails.
   * This is called before the delay.
   */
  onError?: (error: Error, attempt: number, ...args: Parameters<T>) => void;

  /**
   * An AbortSignal to allow for external cancellation of the retry loop.
   */
  signal?: AbortSignal;
}

/**
 * Options for $retry in middleware mode (no handler).
 */
export interface RetryMiddlewareOptions {
  /**
   * The maximum number of attempts.
   *
   * @default 3
   */
  max?: number;

  /**
   * The backoff strategy for delays between retries.
   *
   * @default { initial: 200, factor: 2, jitter: true }
   */
  backoff?: number | RetryBackoffOptions;

  /**
   * An overall time limit for all retry attempts combined.
   */
  maxDuration?: DurationLike;

  /**
   * A function that determines if a retry should be attempted based on the error.
   *
   * @default (error) => true (retries on any error)
   */
  when?: (error: Error) => boolean;

  /**
   * A custom callback for when a retry attempt fails.
   */
  onError?: (error: Error, attempt: number) => void;

  /**
   * An AbortSignal to allow for external cancellation of the retry loop.
   */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------------------------------------------------

export class RetryPrimitive<
  T extends (...args: any[]) => any,
> extends Primitive<RetryPrimitiveOptions<T>> {
  protected readonly retryProvider = $inject(RetryProvider);
  protected appAbortController?: AbortController;

  constructor(args: PrimitiveArgs<RetryPrimitiveOptions<T>>) {
    super(args);

    this.alepha.events.on("stop", () => {
      this.appAbortController?.abort();
      // See the middleware above: an aborted controller must not survive into
      // the next start, or every retry cancels instantly.
      this.appAbortController = undefined;
    });
  }

  async run(...args: Parameters<T>): Promise<ReturnType<T>> {
    // Nov 25: Cloudflare does not like 'new AbortController' outside main handler, we can't pre-create it in the constructor.
    this.appAbortController ??= new AbortController();

    return this.retryProvider.retry(
      {
        ...this.options,
        additionalSignal: this.appAbortController.signal,
      },
      ...args,
    );
  }
}

export interface RetryPrimitiveFn<T extends (...args: any[]) => any>
  extends RetryPrimitive<T> {
  (...args: Parameters<T>): Promise<ReturnType<T>>;
}
