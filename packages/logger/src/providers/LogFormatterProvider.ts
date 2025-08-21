import type { LogEntry } from "../services/Logger.ts";

export abstract class LogFormatterProvider {
	public abstract format(entry: LogEntry): string;
}
