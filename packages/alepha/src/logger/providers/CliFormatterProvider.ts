import type { LogEntry } from "../schemas/logEntrySchema.ts";
import { PrettyFormatterProvider } from "./PrettyFormatterProvider.ts";

/**
 * Compact formatter for CLI output.
 *
 * Renders `HH:MM:SS L message {json}` - a short clock time, a single-letter
 * level colored by severity, the message, and any structured data appended
 * dim. Deliberately drops the `<module.service>`, app name and context UUID
 * that {@link PrettyFormatterProvider} prints: in an interactive CLI session
 * those are noise. Use `pretty` (or `--verbose`) when you need them, `raw`
 * when you want the bare message for piping, and `json` for aggregation.
 */
export class CliFormatterProvider extends PrettyFormatterProvider {
  public override format(entry: LogEntry): string {
    const { data, timestamp, level } = entry;

    const isError = data instanceof Error;
    let details = "";

    if (isError) {
      details = this.formatError(data);
    } else if (data) {
      let error = "";
      let jsonData = data;
      if ("error" in data && data.error instanceof Error) {
        error = this.formatError(data.error);
        const { error: _, ...rest } = data;
        jsonData = rest;
      }

      if (Object.keys(jsonData).length > 0) {
        try {
          details = JSON.stringify(jsonData);
        } catch {
          details = "[Unserializable Object]";
        }
      }

      if (error) {
        details += `\n${error}`;
      }
    }

    let output = "";

    output += this.color.set("GREY_DARK", this.formatClockTime(timestamp));
    output += " ";
    output += this.color.set(level, level.charAt(0).toUpperCase());

    if (entry.message) {
      output += ` ${entry.message}`;
    }

    if (details) {
      if (isError) {
        output += ` \n${details}`;
      } else {
        output += ` ${this.color.set("GREY_DARK", details)}`;
      }
    }

    return output;
  }

  /**
   * Short clock time without milliseconds (HH:MM:SS).
   */
  protected formatClockTime(timestamp: number): string {
    const d = new Date(timestamp);
    return `${this.pad2(d.getHours())}:${this.pad2(d.getMinutes())}:${this.pad2(
      d.getSeconds(),
    )}`;
  }
}
