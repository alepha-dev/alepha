import { $inject, $store, Alepha } from "alepha";
import { logBufferConfig } from "../schemas/logBufferConfig.ts";
import type { LogEntry } from "../schemas/logEntrySchema.ts";
import { LogBuffer } from "../services/LogBuffer.ts";

/**
 * Access to the log buffer of the current execution context.
 *
 * An entry point (the HTTP router, the job runner) seeds a buffer into the
 * context it already opens; every log emitted inside that context is then
 * captured, **including entries suppressed by the active `LOG_LEVEL`** - those
 * are precisely the breadcrumbs worth having when something fails in
 * production.
 *
 * @example
 * ```ts
 * class ErrorReporter {
 *   protected readonly logBuffer = $inject(LogBufferProvider);
 *
 *   public readonly onError = $hook({
 *     on: "server:onError",
 *     handler: ({ request, error }) => {
 *       report(error, { breadcrumbs: this.logBuffer.snapshot() });
 *     },
 *   });
 * }
 * ```
 */
export class LogBufferProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly config = $store(logBufferConfig);

  /**
   * Build the context data that enables capture, meant to be spread into an
   * `alepha.context.run()` call:
   *
   * ```ts
   * alepha.context.run(handler, { context: id, ...logBuffer.seed() });
   * ```
   *
   * Returns an empty object when buffering is disabled, so nothing is written
   * to the ALS store and the push in {@link Logger} stays a no-op.
   *
   * @param max Overrides the configured size — used by callers that retain a
   *            different amount, such as the job runner.
   */
  public seed(max?: number): Record<string, LogBuffer> {
    const size = max ?? this.config.size;
    if (size <= 0) {
      return {};
    }
    return { [LogBuffer.key]: new LogBuffer(size) };
  }

  /**
   * The buffer of the current context, or `undefined` when capture is
   * disabled or no context was opened.
   */
  public current(): LogBuffer | undefined {
    return this.alepha.context.get<LogBuffer>(LogBuffer.key);
  }

  /**
   * Entries logged so far in the current context, most recent last.
   *
   * `undefined` rather than an empty array when nothing was logged, so that
   * callers persisting the result (the job runner writes it to the execution
   * row) store an absent value instead of an empty list.
   */
  public snapshot(): LogEntry[] | undefined {
    const buffer = this.current();
    if (!buffer || buffer.size === 0) {
      return undefined;
    }
    return buffer.snapshot();
  }
}
