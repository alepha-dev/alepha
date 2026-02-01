import { $inject, Alepha } from "alepha";
import type { LogEntry } from "../schemas/logEntrySchema.ts";
import { ConsoleColorProvider } from "./ConsoleColorProvider.ts";
import { LogFormatterProvider } from "./LogFormatterProvider.ts";

export class PrettyFormatterProvider extends LogFormatterProvider {
  protected color = $inject(ConsoleColorProvider);
  protected alepha = $inject(Alepha);

  public format(entry: LogEntry): string {
    const { data, timestamp } = entry;

    let output = "";
    let details = "";

    const isError = data instanceof Error;
    if (isError) {
      details = this.formatError(data);
    } else if (data) {
      try {
        details = JSON.stringify(data);
      } catch {
        details = "[Unserializable Object]";
      }
    }

    output += this.color.set(
      "GREY_DARK",
      `[${this.formatTimestamp(timestamp)}]`,
    );
    output += " ";

    output += this.color.set(entry.level, entry.level.toUpperCase());
    output += " ";

    if (entry.app) {
      output += this.color.set("GREY_DARK", `${entry.app}`);
      output += " ";
    }

    if (entry.context) {
      output += this.color.set(
        "GREY_DARK",
        `(${this.formatContext(entry.context)})`,
      );
      output += " ";
    }

    const module = this.color.set("GREY_LIGHT", `${entry.module}.`);
    const service = this.color.set(
      this.alepha.isBrowser() ? "RESET" : "WHITE",
      entry.service,
    );

    output += `<${module}${service}>`;

    if (entry.message) {
      output += `: ${this.color.set("CYAN", entry.message)}`;
    } else {
      output += ":";
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

  public formatTimestamp(timestamp: number): string {
    const d = new Date(timestamp);
    const h = d.getHours();
    const m = d.getMinutes();
    const s = d.getSeconds();
    const ms = d.getMilliseconds();

    return `${this.pad2(h)}:${this.pad2(m)}:${this.pad2(s)}.${this.pad3(ms)}`;
  }

  protected pad2 = (n: number) => (n < 10 ? "0" : "") + n;
  protected pad3 = (n: number) =>
    n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`;

  /**
   * Avoid to display the whole UUID in development mode
   */
  protected formatContext(context: string): string {
    if (this.alepha.isProduction()) {
      return context;
    }

    return context.slice(0, 8);
  }

  protected formatError(error: Error): string {
    // Chrome does not like stack traces with ASCII colors
    // so we remove the stack trace from log and just print with console.error
    if (this.alepha.isBrowser()) {
      // call console.error in a separate tick to avoid messing with log order
      setTimeout(() => {
        console.error(error);
      });
      return "";
    }

    // hack: use vite's stack trace formatter if available
    const vite = this.alepha.store.get("alepha.vite.server" as any);

    vite?.ssrFixStacktrace(error);

    let str = error.stack ?? error.message;

    const anyError = error as any;
    while (anyError.cause && anyError.cause instanceof Error) {
      vite?.ssrFixStacktrace(anyError.cause);

      str += `\nCaused by: ${anyError.cause.stack ?? anyError.cause.message}`;
      anyError.cause = anyError.cause.cause;
    }

    return str;
  }
}
