import { $inject } from "@alepha/core";
import type { LogEntry } from "../services/Logger.ts";
import { ConsoleColorProvider } from "./ConsoleColorProvider.ts";
import { LogFormatterProvider } from "./LogFormatterProvider.ts";

export class SimpleFormatterProvider extends LogFormatterProvider {
	protected color = $inject(ConsoleColorProvider);

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

		output += this.color.colorize(
			"grey",
			`[${this.formatTimestamp(timestamp)}]`,
		);
		output += " ";

		output += this.color.colorize(entry.level, entry.level.toUpperCase());
		output += " ";

		if (entry.app) {
			output += this.color.colorize("grey", `${entry.app}`);
			output += " ";
		}

		if (entry.context) {
			output += this.color.colorize("grey", `(${entry.context})`);
			output += " ";
		}

		output += `<${this.color.colorize("white", `${entry.module}.`)}${this.color.colorize("reset", entry.service)}>`;

		if (entry.message) {
			output += `: ${this.color.colorize("cyan", entry.message)}`;
		} else {
			output += ":";
		}

		if (details) {
			if (isError) {
				output += ` \n${details}`;
			} else {
				output += ` ${this.color.colorize("darkGrey", details)}`;
			}
		}

		return output;
	}

	public formatTimestamp(d: Date): string {
		const h = d.getHours();
		const m = d.getMinutes();
		const s = d.getSeconds();
		const ms = d.getMilliseconds();

		return `${this.pad2(h)}:${this.pad2(m)}:${this.pad2(s)}.${this.pad3(ms)}`;
	}

	protected pad2 = (n: number) => (n < 10 ? "0" : "") + n;
	protected pad3 = (n: number) =>
		n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`;

	protected formatError(error: Error): string {
		let str = error.stack ?? error.message;

		const anyError = error as any;
		while (anyError.cause && anyError.cause instanceof Error) {
			str += `\nCaused by: ${anyError.cause.stack ?? anyError.cause.message}`;
			anyError.cause = anyError.cause.cause;
		}

		return str;
	}
}
