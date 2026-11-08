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

    if (entry.traceId) {
      json.traceId = entry.traceId;
      json.spanId = entry.spanId;
    }

    if (entry.data instanceof Error) {
      json.error = this.formatJsonError(entry.data);
    } else if (this.isFlat(entry.data)) {
      // Nothing to expand: serialized as it is, without a second copy.
      json.data = entry.data;
    } else {
      json.data = this.expandErrors(entry.data, new Set());
    }

    try {
      return JSON.stringify(json);
    } catch {
      // A last resort: cycles and BigInts are handled by `expandErrors`, but
      // a class instance is passed through as is and may still not serialize.
      // Whatever it is, it must never crash the logging caller.
      json.data = "[Unserializable Object]";
      return JSON.stringify(json);
    }
  }

  /**
   * Whether `data` is absent, or a plain object whose values are all strings,
   * numbers, booleans, `null` or `undefined`: the shape of most log lines
   * (every request line is one), which {@link expandErrors} would copy key by
   * key to change nothing.
   */
  protected isFlat(data: unknown): boolean {
    if (data == null) {
      return true;
    }
    if (
      typeof data !== "object" ||
      Object.getPrototypeOf(data) !== Object.prototype
    ) {
      return false;
    }
    for (const key in data) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== null && typeof value === "object") {
        return false;
      }
      if (typeof value === "bigint") {
        return false;
      }
    }
    return true;
  }

  /**
   * `JSON.stringify` renders an Error as `{}` (its fields are not enumerable),
   * and `log.error("...", { error })` is the common shape across the
   * framework. Walk the data and expand every nested Error the same way a
   * top-level one is.
   *
   * `ancestors` holds the objects on the CURRENT path, added before
   * descending and removed after. A revisit on the path is a cycle and
   * writes `"[Circular]"` at that spot only; an object shared by two
   * branches is expanded in both. It used to be one set for the whole walk,
   * which returned the raw value on any second visit: a shared Error printed
   * as `{}`, and a real cycle reached `JSON.stringify`, which threw and
   * replaced the WHOLE data with `"[Unserializable Object]"`. A BigInt, which
   * `JSON.stringify` refuses too, becomes its decimal string.
   */
  protected expandErrors(value: unknown, ancestors: Set<object>): unknown {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (ancestors.has(value)) {
      return "[Circular]";
    }
    if (value instanceof Error) {
      return this.formatJsonError(value);
    }
    const plain =
      Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype;
    if (!plain) {
      return value;
    }
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((item) => this.expandErrors(item, ancestors));
      }
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = this.expandErrors(item, ancestors);
      }
      return out;
    } finally {
      ancestors.delete(value);
    }
  }

  /**
   * A log entry's `data` made JSON-safe the way this formatter writes it:
   * every Error, top-level or nested, expanded to name, message, stack and
   * cause. For a consumer that serializes entries itself.
   */
  public serializeData(data: unknown): unknown {
    return data instanceof Error
      ? this.formatJsonError(data)
      : this.expandErrors(data, new Set());
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
