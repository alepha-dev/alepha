import type { LogEntry } from "../schemas/logEntrySchema.ts";
import { LogFormatterProvider } from "./LogFormatterProvider.ts";

export class JsonFormatterProvider extends LogFormatterProvider {
  public format(entry: LogEntry): string {
    const json: Record<string, any> = {
      level: entry.level,
      message: entry.message,
      context: entry.context,
      service: entry.service,
      module: entry.module,
      app: entry.app,
      time: entry.timestamp,
    };

    if (entry.data instanceof Error) {
      json.error = this.formatJsonError(entry.data);
    } else {
      json.data = this.expandErrors(entry.data, new WeakSet());
    }

    try {
      return JSON.stringify(json);
    } catch {
      // Circular or BigInt-bearing data must never crash the logging caller.
      json.data = "[Unserializable Object]";
      return JSON.stringify(json);
    }
  }

  /**
   * `JSON.stringify` renders an Error as `{}` (its fields are not enumerable),
   * and `log.error("...", { error })` is the common shape across the
   * framework. Walk the data and expand every nested Error the same way a
   * top-level one is.
   */
  protected expandErrors(value: unknown, seen: WeakSet<object>): unknown {
    if (value instanceof Error) {
      return this.formatJsonError(value);
    }
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((item) => this.expandErrors(item, seen));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = this.expandErrors(item, seen);
    }
    return out;
  }

  public formatJsonError(error: Error): object {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        error.cause instanceof Error
          ? this.formatJsonError(error.cause)
          : undefined,
    };
  }
}
