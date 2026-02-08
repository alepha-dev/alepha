import type { LogEntry } from "../schemas/logEntrySchema.ts";
import { LogDestinationProvider } from "./LogDestinationProvider.ts";

export class MemoryDestinationProvider extends LogDestinationProvider {
  protected entries: Array<LogEntry & { formatted: string }> = [];

  public readonly options = {
    maxEntries: 10_000,
  };

  public write(formatted: string, entry: LogEntry): void {
    this.entries.push({ ...entry, formatted });

    if (this.entries.length > this.options.maxEntries) {
      this.entries = this.entries.slice(
        -Math.floor(this.options.maxEntries * 0.8),
      );
    }
  }

  public get logs() {
    return [...this.entries];
  }

  public clear(): void {
    this.entries = [];
  }
}
