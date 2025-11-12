import {
  $inject,
  Alepha,
  AlephaError,
  type LoggerInterface,
  type LogLevel,
} from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { LogDestinationProvider } from "../providers/LogDestinationProvider.ts";
import { LogFormatterProvider } from "../providers/LogFormatterProvider.ts";
import type { LogEntry } from "../schemas/logEntrySchema.ts";

export class Logger implements LoggerInterface {
  protected readonly alepha = $inject(Alepha);
  protected readonly formatter = $inject(LogFormatterProvider);
  protected readonly destination = $inject(LogDestinationProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

  protected readonly levels: Record<string, number> = {
    SILENT: -1,
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4,
  };

  protected readonly service: string;
  protected readonly module: string;
  protected readonly app?: string;

  protected appLogLevel: string = "INFO";
  protected logLevel: LogLevel = "INFO";

  constructor(service: string, module: string) {
    this.service = service;
    this.module = module;
    this.app = this.alepha.env.APP_NAME;
  }

  public get context(): string | undefined {
    return this.alepha.context.get<string>("context");
  }

  public get level(): string {
    const stateLogLevel = this.alepha.state.get("alepha.logger.level");
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
            throw new AlephaError(
              `Invalid log level '${levelValue?.trim()}' for module pattern '${trimmedModule}'`,
            );
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

    return "INFO";
  }

  private matchesPattern(moduleName: string, pattern: string): boolean {
    if (pattern.includes("*")) {
      // Convert wildcard pattern to regex
      const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
      return new RegExp(`^${regexPattern}`).test(moduleName);
    }

    // Exact prefix match (existing behavior)
    return moduleName.startsWith(pattern);
  }

  public asLogLevel(something: string): LogLevel {
    const level = something.trim().toUpperCase();
    if (this.levels[level] !== undefined) {
      return level as LogLevel;
    }

    throw new AlephaError(`Invalid log level: ${something}`);
  }

  // -------------------------------------------------------------------------------------------------------------------

  public error(message: string, data?: unknown): void {
    this.log("ERROR", message, data);
  }

  public warn(message: string, data?: unknown): void {
    this.log("WARN", message, data);
  }

  public info(message: string, data?: unknown): void {
    this.log("INFO", message, data);
  }

  public debug(message: string, data?: unknown): void {
    this.log("DEBUG", message, data);
  }

  public trace(message: string, data?: unknown): void {
    this.log("TRACE", message, data);
  }

  protected log(level: LogLevel, message: string, data?: unknown): void {
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
      timestamp: this.dateTimeProvider.nowISOString(),
    };

    if (this.levels[level] > this.levels[this.level]) {
      this.emit(logEntry);
      return;
    }

    const formatted = this.formatter.format(logEntry);

    this.emit(logEntry, formatted);

    this.destination.write(formatted, logEntry);
  }

  protected emit(entry: LogEntry, message?: string) {
    this.alepha.events
      .emit(
        "log",
        {
          message,
          entry,
        },
        {
          catch: true,
        },
      )
      .catch(() => null);
  }
}
