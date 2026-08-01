import {
  $inject,
  Alepha,
  AlephaError,
  type LoggerInterface,
  type LogLevel,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { CliFormatterProvider } from "../providers/CliFormatterProvider.ts";
import { JsonFormatterProvider } from "../providers/JsonFormatterProvider.ts";
import { LogDestinationProvider } from "../providers/LogDestinationProvider.ts";
import { LogFormatterProvider } from "../providers/LogFormatterProvider.ts";
import { PrettyFormatterProvider } from "../providers/PrettyFormatterProvider.ts";
import { RawFormatterProvider } from "../providers/RawFormatterProvider.ts";
import type { LogEntry } from "../schemas/logEntrySchema.ts";
import { LogBuffer } from "./LogBuffer.ts";

export class Logger implements LoggerInterface {
  protected readonly alepha = $inject(Alepha);
  /**
   * Formatter chosen at register time (from `LOG_FORMAT`, honoring any
   * custom `LogFormatterProvider` substitution). Used unless a runtime
   * `alepha.logger.format` override is set — see {@link formatter}.
   */
  protected readonly defaultFormatter = $inject(LogFormatterProvider);
  protected readonly jsonFormatter = $inject(JsonFormatterProvider);
  protected readonly prettyFormatter = $inject(PrettyFormatterProvider);
  protected readonly rawFormatter = $inject(RawFormatterProvider);
  protected readonly cliFormatter = $inject(CliFormatterProvider);
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
    const stateLogLevel = this.alepha.store.get("alepha.logger.level");
    if (stateLogLevel && stateLogLevel !== this.appLogLevel) {
      this.appLogLevel = stateLogLevel;
      this.logLevel = this.parseLevel(this.appLogLevel, this.module);
    }
    return this.logLevel;
  }

  /**
   * Active formatter. Honors a runtime `alepha.logger.format` override
   * (read live, like {@link level}); otherwise falls back to the
   * register-time {@link defaultFormatter} so custom substitutions and the
   * `LOG_FORMAT` default keep working.
   */
  protected get formatter(): LogFormatterProvider {
    switch (this.alepha.store.get("alepha.logger.format")) {
      case "json":
        return this.jsonFormatter;
      case "pretty":
        return this.prettyFormatter;
      case "raw":
        return this.rawFormatter;
      case "cli":
        return this.cliFormatter;
      default:
        return this.defaultFormatter;
    }
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
          throw new AlephaError(`Invalid global log level "${trimmedPart}"`);
        }
      }
    }

    return "INFO";
  }

  protected matchesPattern(moduleName: string, pattern: string): boolean {
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

  /**
   * Whether a message at `level` would actually be emitted given the current
   * active level (read live from state). Mirrors the threshold used by
   * {@link log}: a level is enabled when it sits at or above the active one.
   *
   * @example
   * // active level = INFO
   * log.isLevelEnabled("DEBUG"); // false
   * log.isLevelEnabled("WARN");  // true
   */
  public isLevelEnabled(level: LogLevel): boolean {
    return this.levels[level] <= this.levels[this.level];
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
    if (typeof data === "object" && data) {
      _data = data;
    } else if (typeof message === "object" && message) {
      _data = message;
    }

    const logEntry: LogEntry = {
      level,
      message: _message,
      data: this.redact(_data),
      context: this.context,
      service: this.service,
      module: this.module,
      app: this.app,
      timestamp: this.dateTimeProvider.nowMillis(),
    };

    // Captured before the level check, for the same reason the `log` event is
    // emitted below it: an entry too verbose to print is exactly the kind of
    // breadcrumb worth having attached to an error report.
    this.alepha.context.get<LogBuffer>(LogBuffer.key)?.push(logEntry);

    if (this.levels[level] > this.levels[this.level]) {
      // Suppressed for the console, but still EMITTED. Review #3 proposed
      // early-returning before building the entry; that would starve the
      // `log` event, which is what feeds the devtools log viewer — a
      // `LOG_LEVEL=info` process would show no trace/debug there at all.
      // The expensive half (formatting) is already skipped.
      this.emit(logEntry);
      return;
    }

    const formatted = this.formatter.format(logEntry);

    this.emit(logEntry, formatted);

    this.destination.write(formatted, logEntry);
  }

  /**
   * Keys whose values are masked before the entry reaches any formatter,
   * destination, or devtools. Matched case-insensitively, ignoring `-`/`_`,
   * as a substring — so `authorization`, `x-api-key`, `refreshToken` and
   * `set-cookie` are all covered.
   */
  protected readonly redactedKeys = [
    "authorization",
    "cookie",
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "accesskey",
    "privatekey",
    "credential",
    "sessionid",
  ];

  protected static readonly REDACTED = "[redacted]";

  /**
   * Mask credential-bearing values anywhere in the log payload.
   *
   * Without this, a single `log.debug("request", { headers })` ships bearer
   * tokens and cookies to stdout, the log aggregator, and the devtools log
   * viewer. Structure and non-secret fields are preserved so the entry stays
   * useful for debugging.
   *
   * Errors are passed through untouched (formatters rely on the instance),
   * and cycles are handled — logging must never throw.
   */
  protected redact(
    data: object | Error | undefined,
  ): object | Error | undefined {
    if (!data || data instanceof Error) {
      return data;
    }

    const isSecretKey = (key: string): boolean => {
      const normalized = key.toLowerCase().replace(/[-_]/g, "");
      return this.redactedKeys.some((needle) => normalized.includes(needle));
    };

    const seen = new WeakSet<object>();
    const walk = (value: unknown): unknown => {
      if (value === null || typeof value !== "object") {
        return value;
      }
      if (value instanceof Error || value instanceof Date) {
        return value;
      }
      if (seen.has(value)) {
        return "[circular]";
      }
      seen.add(value);

      if (Array.isArray(value)) {
        return value.map(walk);
      }

      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = isSecretKey(key) ? Logger.REDACTED : walk(item);
      }
      return out;
    };

    try {
      return walk(data) as object;
    } catch {
      // Never let redaction break logging.
      return data;
    }
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
