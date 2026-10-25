import { $error, type ErrorClass } from "../primitives/$error.ts";
import { z } from "../providers/ZodProvider.ts";

/**
 * The reason a deadline aborts its signal with: the work did not finish in
 * the time it was given.
 *
 * Unlike an {@link AbortedError}, a timeout is a failure, not an outcome:
 * `alepha.context.isAbortError` never recognises it, a job run that timed out
 * records an error, and an action answers 503 with it. 503 rather than 504,
 * the meaning `DbTimeoutError` already carries: the server did not answer in
 * time, retry. `data.timeout` is the budget it enforced, in milliseconds.
 *
 * ```ts
 * if (signal.reason instanceof TimeoutError) {
 *   // the deadline fired, not a disconnect
 * }
 * ```
 *
 * It lives in `alepha`, not `alepha/server`, because `DateTimeProvider.deadline`
 * raises it and `alepha/datetime` never imports the server. `status` reads
 * `data.status`, as it does on every HTTP error, so the router and a strict
 * `$action` classify it by status like any other.
 */
export const TimeoutError = $error({
  name: "TIMEOUT",
  schema: z.object({
    status: z.number(),
    timeout: z.number(),
  }),
  default: { status: 503, timeout: 0 },
  message: (data) =>
    data.timeout <= 0
      ? "Timed out"
      : data.timeout % 1000 === 0
        ? `Timed out after ${data.timeout / 1000} s`
        : `Timed out after ${data.timeout} ms`,
}) as unknown as ErrorClass<
  { status: number; timeout: number },
  "status" | "timeout",
  "status"
>;

export type TimeoutError = InstanceType<typeof TimeoutError>;

Object.defineProperty(TimeoutError.prototype, "status", {
  get(this: { data: { status: number } }) {
    return this.data.status;
  },
  enumerable: false,
  configurable: true,
});
