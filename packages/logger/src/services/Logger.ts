import {
	$inject,
	Alepha,
	type LoggerInterface,
	type LogLevel,
} from "@alepha/core";
import { LogDestinationProvider } from "../providers/LogDestinationProvider.ts";
import { LogFormatterProvider } from "../providers/LogFormatterProvider.ts";

export class Logger implements LoggerInterface {
	protected readonly alepha = $inject(Alepha);
	protected readonly formatter = $inject(LogFormatterProvider);
	protected readonly destination = $inject(LogDestinationProvider);

	protected readonly levels: Record<string, number> = {
		silent: -1,
		error: 0,
		warn: 1,
		info: 2,
		debug: 3,
		trace: 4,
	};

	protected readonly service: string;
	protected readonly module: string;
	protected readonly app?: string;

	protected appLogLevel: string = "info";
	protected logLevel: LogLevel = "info";

	constructor(service: string, module: string) {
		this.service = service;
		this.module = module;
		this.app = this.alepha.env.APP_NAME;
	}

	public get context(): string | undefined {
		return this.alepha.context.get<string>("context");
	}

	public get level(): string {
		const stateLogLevel = this.alepha.state("logLevel");
		if (stateLogLevel && stateLogLevel !== this.appLogLevel) {
			this.appLogLevel = stateLogLevel;
			this.logLevel = this.parseLevel(this.appLogLevel, this.module);
		}
		return this.logLevel;
	}

	public parseLevel(level: string, app: string): LogLevel {
		const parts = level.toLowerCase().split(/[,;]/);

		// First pass: check for module-specific configurations
		for (const part of parts) {
			const trimmedPart = part.trim();
			if (!trimmedPart) continue; // Skip empty parts

			if (trimmedPart.includes(":") || trimmedPart.includes("=")) {
				const [modulePattern, levelValue] = trimmedPart.split(/[:=]/);
				const trimmedModule = modulePattern.trim();
				const trimmedLevel = levelValue?.trim();

				if (!trimmedLevel) continue; // Skip if no level specified

				if (this.matchesPattern(app, trimmedModule)) {
					try {
						return this.asLogLevel(trimmedLevel);
					} catch (error) {
						throw new Error(`Invalid log level "${levelValue?.trim()}" for module pattern "${trimmedModule}"`);
					}
				}
			}
		}

		// Second pass: look for global level
		for (const part of parts) {
			const trimmedPart = part.trim();
			if (!trimmedPart) continue; // Skip empty parts

			if (!trimmedPart.includes(":") && !trimmedPart.includes("=")) {
				try {
					return this.asLogLevel(trimmedPart);
				} catch (error) {
					throw new Error(`Invalid global log level "${trimmedPart}"`);
				}
			}
		}

		return "info";
	}

	private matchesPattern(moduleName: string, pattern: string): boolean {
		if (pattern.includes("*")) {
			// Convert wildcard pattern to regex
			const regexPattern = pattern
				.replace(/\./g, "\\.")
				.replace(/\*/g, ".*");
			return new RegExp(`^${regexPattern}`).test(moduleName);
		}

		// Exact prefix match (existing behavior)
		return moduleName.startsWith(pattern);
	}

	public asLogLevel(something: string): LogLevel {
		const level = something.trim();
		if (this.levels[level] !== undefined) {
			return level as LogLevel;
		}

		throw new Error(`Invalid log level: ${something}`);
	}

	// -------------------------------------------------------------------------------------------------------------------

	public error(message: string, data?: unknown): void {
		this.log("error", message, data);
	}

	public warn(message: string, data?: unknown): void {
		this.log("warn", message, data);
	}

	public info(message: string, data?: unknown): void {
		this.log("info", message, data);
	}

	public debug(message: string, data?: unknown): void {
		this.log("debug", message, data);
	}

	public trace(message: string, data?: unknown): void {
		this.log("trace", message, data);
	}

	protected log(level: LogLevel, message: string, data?: unknown): void {
		if (this.levels[level] > this.levels[this.level]) {
			return;
		}

		let _message = "";
		if (typeof message === "string") {
			_message = message;
		} else if (typeof data === "string") {
			_message = data;
		}

		let _data: object | Error | undefined;
		if (typeof data === "object" && !!data) {
			_data = data;
		} else if (typeof message === "object" && message) {
			_data = message;
		}

		const logEntry: LogEntry = {
			level,
			message: _message,
			data: _data,
			context: this.context,
			service: this.service,
			module: this.module,
			app: this.app,
			timestamp: new Date(),
		};

		const formatted = this.formatter.format(logEntry);

		this.alepha
			.emit("log", {
				message: formatted,
				entry: logEntry,
			})
			.catch(() => null);

		this.destination.write(formatted, logEntry);
	}
}

export interface LogEntry {
	level: LogLevel;
	message: string;
	service: string;
	module: string;
	context?: string;
	data?: object | Error | string;
	app?: string;
	timestamp: Date;
}
