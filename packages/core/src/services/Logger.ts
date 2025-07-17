import type { AlsProvider } from "../providers/AlsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace" | "silent";

// ---------------------------------------------------------------------------------------------------------------------

export interface LoggerEnv {
	/**
	 * Default log level for the application.
	 * Default by environment:
	 * - dev = "debug"
	 * - test = "error"
	 * - prod = "info"
	 *
	 * "trace" | "debug" | "info" | "warn" | "error" | "silent"
	 */
	LOG_LEVEL?: string;

	/**
	 * Disable colors in the console output.
	 */
	NO_COLOR?: string;

	/**
	 * Force color output for the application.
	 */
	FORCE_COLOR?: string;

	/**
	 * Log format.
	 *
	 * @default "text"
	 */
	LOG_FORMAT?: "json" | "text" | "cli" | "raw";
}

// ---------------------------------------------------------------------------------------------------------------------

export interface LoggerOptions {
	/**
	 * The logging level. Can be one of "error", "warn", "info", "debug", or "trace".
	 */
	level?: string;

	app?: string;

	/**
	 * The name of the logger. Like a module name or a service name.
	 */
	name?: string;

	/**
	 * An optional context to include in the log output. Like a request ID or a correlation ID.
	 */
	context?: string;

	/**
	 * An optional tag to include in the log output. Like a class name or a module name.
	 */
	caller?: string;

	/**
	 * Whether to use colors in the log output. Defaults to true.
	 */
	color?: boolean;

	/**
	 * Log output format. Can be "json", "text", or "cli".
	 */
	format?: string;

	/**
	 * An optional async local storage provider to use for storing context information.
	 */
	als?: AlsProvider;
}

// ---------------------------------------------------------------------------------------------------------------------

export const COLORS = {
	reset: "\x1b[0m",
	grey: "\x1b[90m",
	red: "\x1b[31m",
	orange: "\x1b[33m", // using yellow for orange-ish
	green: "\x1b[32m",
	blue: "\x1b[34m",
	white: "\x1b[37m",
	cyan: "\x1b[36m",
	darkGrey: "\x1b[90m", // same as grey for terminal standard
};

export const LEVEL_COLORS: Record<string, string> = {
	silent: "",
	error: COLORS.red,
	warn: COLORS.orange,
	info: COLORS.green,
	debug: COLORS.blue,
	trace: COLORS.grey,
};

// ---------------------------------------------------------------------------------------------------------------------

export class Logger {
	protected levelOrder: Record<string, number> = {
		silent: -1,
		error: 0,
		warn: 1,
		info: 2,
		debug: 3,
		trace: 4,
	};

	public readonly level: string;
	public readonly rawLevel: string;
	public readonly name: string;

	protected caller: string;
	protected context: string;
	protected app: string;
	protected color: boolean;
	protected format: string;
	protected als?: AlsProvider;

	constructor(options: LoggerOptions = {}) {
		this.rawLevel = options.level ?? "info";
		this.name = options.name ?? "app";

		this.level = this.parseLevel(this.rawLevel, this.name);

		this.caller = options.caller ?? "";
		this.context = options.context ?? "";
		this.app = options.app ?? "";
		this.format = options.format ?? "text";
		this.color = options.color ?? this.format !== "json";
		this.als = options.als;
	}

	public parseLevel(level: string, app: string): LogLevel {
		const parts = level.toLowerCase().split(/[,;]/);
		for (const part of parts) {
			if (part.includes(":") || part.includes("=")) {
				const [module, level] = part.split(/[:=]/);
				if (app.startsWith(module.trim())) {
					return this.asLogLevel(level);
				}
			}
		}

		for (const part of parts) {
			if (!part.includes(":") && !part.includes("=")) {
				return this.asLogLevel(part);
			}
		}

		return "info";
	}

	public asLogLevel(something: string): LogLevel {
		const level = something.trim();
		if (this.levelOrder[level] !== undefined) {
			return level as LogLevel;
		}

		throw new Error(`Invalid log level: ${something}`);
	}

	public child(options: LoggerOptions): Logger {
		return new Logger({
			...options,
			level: options.level ?? this.rawLevel,
			name: options.name ?? this.name,
			caller: options.caller ?? this.caller,
			context: options.context ?? this.context,
			color: options.color ?? this.color,
			format: options.format ?? this.format,
			als: options.als ?? this.als,
			app: options.app ?? this.app,
		});
	}

	public error(
		message: unknown,
		data?: object | Error | string | unknown,
	): void {
		this.log("error", message, data as object | Error | string);
	}

	public warn(message: unknown, data?: object | Error | string): void {
		this.log("warn", message, data);
	}

	public info(message: unknown, data?: object | Error | string): void {
		this.log("info", message, data);
	}

	public debug(message: unknown, data?: object | Error | string): void {
		this.log("debug", message, data);
	}

	public trace(message: unknown, data?: object | Error | string): void {
		this.log("trace", message, data);
	}

	/**
	 * Log a message to the console.
	 */
	protected log(
		level: LogLevel,
		message: unknown,
		data?: object | Error | string,
	): void {
		if (this.levelOrder[level] > this.levelOrder[this.level]) {
			return;
		}

		let _message = "";
		if (typeof message === "string") {
			_message = message;
		} else if (typeof data === "string") {
			_message = data;
		}

		let _data: object | Error | undefined;
		if (typeof data === "object") {
			_data = data;
		} else if (typeof message === "object" && message) {
			_data = message;
		}

		const formatted = this.formatLog(level, _message, _data);

		this.print(formatted);
	}

	/**
	 * Print a log message to the console.
	 */
	protected print(formatted: string): void {
		console.log(formatted);
	}

	/**
	 * Format a log message to JSON.
	 */
	protected formatJson(
		level: LogLevel,
		message: unknown,
		data?: object | Error | string,
	): string {
		const json: Record<string, any> = {
			date: new Date().toISOString(),
			app: this.app,
			module: this.name,
			caller: this.caller,
			context: this.context ? this.context : undefined,
			level,
			message: message,
		};

		if (data instanceof Error) {
			json.error = this.formatJsonError(data);
		} else {
			Object.assign(json, data);
		}

		return JSON.stringify(json);
	}

	protected formatJsonError(error: Error): object {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			cause:
				error.cause instanceof Error
					? this.formatJsonError(error.cause)
					: undefined,
		};
	}

	/**
	 * Format a log message to a string.
	 */
	protected formatLog(
		level: LogLevel,
		message: string,
		data?: object | Error,
	): string {
		const context = this.als?.get<string>("context");
		if (context) {
			this.context = context;
		} else {
			this.context = "";
		}

		if (this.format === "json") {
			return this.formatJson(level, message, data);
		}

		const now = new Date();
		const date = `${now.toLocaleTimeString()}.${now.getMilliseconds()}`;
		const levelStr = level.toUpperCase();
		let output = "";
		let dataStr = "";

		const isError = data instanceof Error;
		if (isError) {
			dataStr = this.formatError(data);
		} else if (data) {
			try {
				dataStr = JSON.stringify(data);
			} catch {
				dataStr = "[Unserializable Object]";
			}
		}

		if (this.format === "cli") {
			output += this.colorize(COLORS.grey, `[${date}]`);
			output += " ";

			output += this.colorize(LEVEL_COLORS[level], levelStr);
			output += " ";

			if (message) {
				output += `${message}`;
			}

			if (dataStr) {
				if (isError) {
					output += ` \n${dataStr}`;
				} else {
					output += ` ${this.colorize(COLORS.darkGrey, dataStr)}`;
				}
			}

			return output;
		}

		if (this.format === "raw") {
			if (message) {
				output += `${message}`;
			}
			if (dataStr) {
				if (isError) {
					output += ` \n${dataStr}`;
				}
			}
			return output;
		}

		output += this.colorize(COLORS.grey, `[${date}]`);
		output += " ";

		output += this.colorize(LEVEL_COLORS[level], levelStr);
		output += " ";

		if (this.app) {
			output += this.colorize(COLORS.grey, `${this.app}`);
			output += " ";
		}

		if (this.context) {
			output += this.colorize(COLORS.grey, `(${this.context})`);
			output += " ";
		}

		if (this.caller) {
			output += `<${this.colorize(COLORS.white, `${this.name}.`)}${this.colorize(COLORS.reset, this.caller)}>`;
		}

		if (message) {
			output += `: ${this.colorize(COLORS.cyan, message)}`;
		} else {
			output += ":";
		}

		if (dataStr) {
			if (isError) {
				output += ` \n${dataStr}`;
			} else {
				output += ` ${this.colorize(COLORS.darkGrey, dataStr)}`;
			}
		}

		return output;
	}

	protected colorize(
		color: string,
		text: string,
		reset: string = COLORS.reset,
	): string {
		if (!this.color) {
			return text;
		}

		return `${color}${text}${reset}`;
	}

	/**
	 * Format an error to a string.
	 *
	 * @param error
	 * @protected
	 */
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

// ---------------------------------------------------------------------------------------------------------------------

export class MockLogger extends Logger {
	store: MockLoggerStore;

	constructor(
		options: LoggerOptions & { store: MockLoggerStore } = {
			store: { stack: [] },
		},
	) {
		super({
			...options,
			level: options.level ?? "info",
			name: options.name ?? "App",
			caller: options.caller ?? "",
			context: options.context ?? "",
			color: false,
			format: "json",
			als: options.als,
			app: options.app,
		});
		this.store = options.store;
	}

	public print(msg: string): void {
		this.store.stack.push(JSON.parse(msg));
	}

	public child(options: LoggerOptions): MockLogger {
		return new MockLogger({
			...options,
			level: options.level ?? this.level,
			name: options.name ?? this.name,
			caller: options.caller ?? this.caller,
			context: options.context ?? this.context,
			color: options.color ?? this.color,
			format: options.format ?? this.format,
			als: options.als ?? this.als,
			app: options.app ?? this.app,
			store: this.store,
		});
	}

	public reset(): void {
		this.store.stack = [];
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export interface MockLoggerStore {
	stack: Array<
		{
			date: string;
			level: string;
			message: string;
			context?: string;
			app?: string;
		} & Record<string, any>
	>;
}
