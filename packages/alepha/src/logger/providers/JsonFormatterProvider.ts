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
      json.data = entry.data;
    }

    try {
      return JSON.stringify(json);
    } catch {
      // Circular or BigInt-bearing data must never crash the logging caller.
      json.data = "[Unserializable Object]";
      return JSON.stringify(json);
    }
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
