import type { LogEntry } from "../schemas/logEntrySchema.ts";

export abstract class LogDestinationProvider {
  public abstract write(message: string, entry: LogEntry): void;
}
