import type { LogEntry } from "../schemas/logEntrySchema.ts";

export abstract class LogFormatterProvider {
  public abstract format(entry: LogEntry): string;
}
