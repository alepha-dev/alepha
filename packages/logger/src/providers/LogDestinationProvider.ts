import type { LogEntry } from "../services/Logger.ts";

export abstract class LogDestinationProvider {
	public abstract write(message: string, entry: LogEntry): void;
}
