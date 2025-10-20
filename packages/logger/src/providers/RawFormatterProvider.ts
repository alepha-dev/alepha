import type { LogEntry } from "../schemas/logEntrySchema.ts";
import { LogFormatterProvider } from "./LogFormatterProvider.ts";

export class RawFormatterProvider extends LogFormatterProvider {
  public format(entry: LogEntry): string {
    let output = "";

    output += `${entry.message}`;

    if (entry.data instanceof Error) {
      output += `\n${entry.data.message}`;
      let cause = entry.data.cause;
      while (cause instanceof Error) {
        output += `\nCaused by: ${cause.message}`;
        cause = cause.cause;
      }
    }

    return output;
  }
}
