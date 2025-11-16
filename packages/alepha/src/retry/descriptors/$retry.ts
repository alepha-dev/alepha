import {
  $inject,
  createDescriptor,
  Descriptor,
  type DescriptorArgs,
  KIND,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import type { RetryBackoffOptions } from "../providers/RetryProvider.ts";
import { RetryProvider } from "../providers/RetryProvider.ts";

/**
 * Creates a function that automatically retries a handler upon failure,
 * with support for exponential backoff, max duration, and cancellation.
 */
export const $retry = <T extends (...args: any[]) => any>(
  options: RetryDescriptorOptions<T>,
): RetryDescriptorFn<T> => {
  const instance = createDescriptor(RetryDescriptor, options);
  const fn = (...args: Parameters<T>) => instance.run(...args);
  return Object.setPrototypeOf(fn, instance) as RetryDescriptorFn<T>;
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RetryDescriptorOptions<T extends (...args: any[]) => any> {
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

export class RetryDescriptor<
  T extends (...args: any[]) => any,
> extends Descriptor<RetryDescriptorOptions<T>> {
  protected readonly retryProvider = $inject(RetryProvider);
  protected appAbortController: AbortController;

  constructor(args: DescriptorArgs<RetryDescriptorOptions<T>>) {
    super(args);

    this.appAbortController = new AbortController();
    this.alepha.events.on("stop", () => {
      this.appAbortController.abort();
    });
  }

  async run(...args: Parameters<T>): Promise<ReturnType<T>> {
    return this.retryProvider.retry(
      {
        ...this.options,
        additionalSignal: this.appAbortController.signal,
      },
      ...args,
    );
  }
}

export interface RetryDescriptorFn<T extends (...args: any[]) => any>
  extends RetryDescriptor<T> {
  (...args: Parameters<T>): Promise<ReturnType<T>>;
}

$retry[KIND] = RetryDescriptor;
