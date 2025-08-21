import type { LogEntry } from "../services/Logger.ts";
import { LogFormatterProvider } from "./LogFormatterProvider.ts";

export class RawFormatterProvider extends LogFormatterProvider {
	public format(entry: LogEntry): string {
		let output = "";

		output += `${entry.message}`;

		return output;
	}
}
