export type LogLevel = "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface LoggerInterface {
	trace(message: string, data?: unknown): void;
	debug(message: string, data?: unknown): void;
	info(message: string, data?: unknown): void;
	warn(message: string, data?: unknown): void;
	error(message: string, data?: unknown): void;
}
