export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE" | "SILENT";

export interface LoggerInterface {
  trace(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}
