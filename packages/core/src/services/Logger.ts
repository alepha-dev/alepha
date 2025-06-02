import type { AsyncLocalStorageProvider } from "../providers/AsyncLocalStorageProvider.ts";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface LoggerEnv {
	/**
	 * Default log level for the application.
	 * Default by environment:
	 * - dev = "debug"
	 * - test = "error"
	 * - prod = "info"
	 */
	LOG_LEVEL?: "trace" | "debug" | "info" | "warn" | "error" | "silent";

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
	LOG_FORMAT?: "json" | "text";
}

export interface LoggerOptions {
	/**
	 * The logging level. Can be one of "error", "warn", "info", "debug", or "trace".
	 */
	level?: LogLevel;

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
	 * Whether to log in JSON format. Defaults to false.
	 */
	json?: boolean;

	/**
	 * An optional async local storage provider to use for storing context information.
	 */
	als?: AsyncLocalStorageProvider;
}

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

export const LEVEL_COLORS: Record<LogLevel, string> = {
	silent: "",
	error: COLORS.red,
	warn: COLORS.orange,
	info: COLORS.green,
	debug: COLORS.blue,
	trace: COLORS.grey,
};

export class Logger {
	protected levelOrder: Record<LogLevel, number> = {
		silent: -1,
		error: 0,
		warn: 1,
		info: 2,
		debug: 3,
		trace: 4,
	};

	public readonly level: LogLevel;
	public readonly name: string;
	protected caller: string;
	protected context: string;
	protected color: boolean;
	protected json: boolean;
	protected als?: AsyncLocalStorageProvider;

	constructor(options: LoggerOptions = {}) {
		this.level = options.level ?? "info";
		this.name = options.name ?? "App";
		this.caller = options.caller ?? "";
		this.context = options.context ?? "";
		this.json = options.json ?? false;
		this.color = options.color ?? !this.json;
		this.als = options.als;
	}

	public child(options: LoggerOptions) {
		return new Logger({
			...options,
			level: options.level ?? this.level,
			name: options.name ?? this.name,
			caller: options.caller ?? this.caller,
			context: options.context ?? this.context,
			color: options.color ?? this.color,
			json: options.json ?? this.json,
			als: options.als ?? this.als,
		});
	}

	public error(message: unknown, data?: object | Error | string | unknown) {
		this.log("error", message, data as object | Error | string);
	}

	public warn(message: unknown, data?: object | Error | string) {
		this.log("warn", message, data);
	}

	public info(message: unknown, data?: object | Error | string) {
		this.log("info", message, data);
	}

	public debug(message: unknown, data?: object | Error | string) {
		this.log("debug", message, data);
	}

	public trace(message: unknown, data?: object | Error | string) {
		this.log("trace", message, data);
	}

	/**
	 * Log a message to the console.
	 *
	 * @param level
	 * @param message
	 * @param data
	 * @protected
	 */
	protected log(
		level: LogLevel,
		message: unknown,
		data?: object | Error | string,
	) {
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
	 *
	 * @param formatted
	 * @protected
	 */
	protected print(formatted: string) {
		console.log(formatted);
	}

	/**
	 * Format a log message to JSON.
	 *
	 * @param level
	 * @param message
	 * @param data
	 * @protected
	 */
	protected formatJson(
		level: LogLevel,
		message: unknown,
		data?: object | Error | string,
	): string {
		return JSON.stringify({
			date: new Date().toISOString(),
			name: this.name,
			caller: this.caller,
			context: this.context ? this.context : undefined,
			level,
			msg: message,
			data,
		});
	}

	/**
	 * Format a log message to a string.
	 *
	 * @param level
	 * @param message
	 * @param data
	 * @protected
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

		if (this.json) {
			return this.formatJson(level, message, data);
		}

		const now = new Date();
		const date = now.toISOString().split("T")[1].split("Z")[0];
		const levelStr = level.toUpperCase();

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

		let output = "";

		output += this.colorize(COLORS.grey, `[${date}]`);
		output += " ";

		output += this.colorize(LEVEL_COLORS[level], levelStr);
		output += " ";

		if (this.context) {
			output += `(${this.name}/${this.context})`;
		} else {
			output += `(${this.name})`;
		}

		if (this.caller) {
			output += ` <${this.caller}>`;
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
		reset = COLORS.reset,
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

// ---

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
			json: true,
			als: options.als,
		});
		this.store = options.store;
	}

	print(msg: string) {
		this.store.stack.push(JSON.parse(msg));
	}

	child(options: LoggerOptions) {
		return new MockLogger({
			...options,
			level: options.level ?? this.level,
			name: options.name ?? this.name,
			caller: options.caller ?? this.caller,
			context: options.context ?? this.context,
			color: options.color ?? this.color,
			json: options.json ?? this.json,
			als: options.als ?? this.als,
			store: this.store,
		});
	}
}

export interface MockLoggerStore {
	stack: Array<{ date: string; level: string; msg: string; data?: object }>;
}
