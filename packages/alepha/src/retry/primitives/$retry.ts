import {
  $inject,
  createPrimitive,
  KIND,
  Primitive,
  type PrimitiveArgs,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import type { RetryBackoffOptions } from "../providers/RetryProvider.ts";
import { RetryProvider } from "../providers/RetryProvider.ts";

/**
 * Creates a function that automatically retries a handler upon failure,
 * with support for exponential backoff, max duration, and cancellation.
 */
export const $retry = <T extends (...args: any[]) => any>(
  options: RetryPrimitiveOptions<T>,
): RetryPrimitiveFn<T> => {
  const instance = createPrimitive(RetryPrimitive, options);
  const fn = (...args: Parameters<T>) => instance.run(...args);
  return Object.setPrototypeOf(fn, instance) as RetryPrimitiveFn<T>;
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

$retry[KIND] = RetryPrimitive;
