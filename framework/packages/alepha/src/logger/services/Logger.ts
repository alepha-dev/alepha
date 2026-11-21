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
   * `alepha.logger.format` override is set, see {@link formatter}.
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

  protected logLevel: LogLevel = "INFO";

  /**
   * What this container's loggers share about the level, and the
   * {@link LoggerLevelState.epoch} this logger last resolved its level at.
   */
  protected levelState?: LoggerLevelState;
  protected levelEpoch = -1;

  constructor(service: string, module: string) {
    this.service = service;
    this.module = module;
  }

  /**
   * The `app` field of every entry: `alepha.name`, read per entry rather than
   * at construction, because on workerd a logger can be built before
   * `loadEnv()` lifts the Worker's `APP_NAME` binding.
   *
   * Absent when the name is only the no-build `"app"` fallback (specs, `tsx`
   * scripts): printed on every line there, it would say nothing.
   */
  protected get app(): string | undefined {
    if (!this.alepha.env.APP_NAME && this.alepha.meta.name === "unknown") {
      return undefined;
    }
    return this.alepha.name;
  }

  public get context(): string | undefined {
    return this.alepha.context.get<string>("context");
  }

  /**
   * The active span, read from the ALS by the key `alepha/tracing` owns
   * (`Tracer.key`), so this module does not import the tracer. Absent
   * outside any trace.
   */
  protected get span(): { traceId: string; spanId: string } | undefined {
    return this.alepha.context.get<{ traceId: string; spanId: string }>(
      Logger.spanKey,
    );
  }

  /**
   * `Tracer.key`, spelled out: `alepha/tracing` imports this module's
   * consumers, never the reverse.
   */
  protected static readonly spanKey = "alepha.tracing.span";

  /**
   * The active level, resolved again only when `alepha.logger.level` changes.
   *
   * The change is recorded once for the container, in {@link levelStates},
   * and each logger resolves its own level from that shared state: two
   * loggers of one module always agree, whichever met the value first. See
   * {@link applyLevel} for what an invalid value does.
   */
  public get level(): string {
    const stateLogLevel = this.alepha.store.get("alepha.logger.level");
    if (!stateLogLevel) {
      return this.logLevel;
    }
    const state = (this.levelState ??= this.sharedLevelState());
    if (state.current !== stateLogLevel) {
      this.recordLevel(state, stateLogLevel);
    }
    if (this.levelEpoch !== state.epoch) {
      this.levelEpoch = state.epoch;
      this.applyLevel(state);
    }
    return this.logLevel;
  }

  protected static readonly levelStates = new WeakMap<
    Alepha,
    LoggerLevelState
  >();

  protected sharedLevelState(): LoggerLevelState {
    let state = Logger.levelStates.get(this.alepha);
    if (!state) {
      state = { epoch: 0, reported: new Set() };
      Logger.levelStates.set(this.alepha, state);
    }
    return state;
  }

  /**
   * Records a new store value for the whole container: whether its global
   * level parses, and if so that it is now the last valid value.
   */
  protected recordLevel(state: LoggerLevelState, level: string): void {
    state.current = level;
    state.epoch++;
    state.reported.clear();
    try {
      this.parseGlobalLevel(this.levelParts(level));
      state.valid = level;
      state.invalid = undefined;
    } catch (error) {
      state.invalid = (error as Error).message;
    }
  }

  /**
   * Resolves the container's store value into {@link logLevel}. It runs
   * inside every log call, so an invalid value is reported and must not make
   * the call fail:
   * - a `pattern:level` part with an invalid level is ignored: the modules
   *   it names follow the global level;
   * - an invalid global level refuses the value for every module no valid
   *   part of it names: their level comes from the last valid value of the
   *   container, or is INFO when there has been none.
   *
   * Each refusal is logged once, as a warning, until the store value changes.
   *
   * The one value that throws is an invalid global level while the container
   * has had no valid one and has not started: `LOG_LEVEL=verbose` fails the
   * first log call of each logger with its reason, as it always did.
   */
  protected applyLevel(state: LoggerLevelState): void {
    const reasons: string[] = [];
    let resolved = this.moduleLevel(state.current, reasons);

    if (!resolved && state.invalid) {
      if (state.valid === undefined && !this.alepha.isStarted()) {
        this.logLevel = "INFO";
        throw new AlephaError(state.invalid);
      }
      reasons.push(
        state.valid === undefined
          ? `${state.invalid}: no valid level was set, the level is INFO`
          : `${state.invalid}: the last valid level, "${state.valid}", applies`,
      );
      resolved = this.moduleLevel(state.valid, []);
    }

    const source = state.invalid ? state.valid : state.current;
    this.logLevel =
      resolved ??
      (source === undefined
        ? "INFO"
        : (this.parseGlobalLevel(this.levelParts(source)) ?? "INFO"));

    for (const reason of reasons) {
      if (!state.reported.has(reason)) {
        state.reported.add(reason);
        this.warn(reason);
      }
    }
  }

  /**
   * The level the first `pattern:level` part of `level` naming this logger's
   * module gives it, if any. When the level of that part is invalid, the
   * refusal is added to `reasons`, as the sentence to log, and there is no
   * module level: a later part naming the module is not looked at.
   */
  protected moduleLevel(
    level: string | undefined,
    reasons: string[],
  ): LogLevel | undefined {
    if (level === undefined) {
      return undefined;
    }
    try {
      return this.parseModuleLevel(this.levelParts(level), this.module);
    } catch (error) {
      reasons.push(
        `${(error as Error).message}: its modules follow the global level`,
      );
      return undefined;
    }
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
    const parts = this.levelParts(level);
    return (
      this.parseModuleLevel(parts, app) ??
      this.parseGlobalLevel(parts) ??
      "INFO"
    );
  }

  protected levelParts(level: string): string[] {
    return level.toLowerCase().split(/[,;]/);
  }

  /**
   * The level of the first `pattern:level` part matching `app`, if any.
   */
  protected parseModuleLevel(
    parts: string[],
    app: string,
  ): LogLevel | undefined {
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
    return undefined;
  }

  /**
   * The level of the first part naming no module, if any.
   */
  protected parseGlobalLevel(parts: string[]): LogLevel | undefined {
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
    return undefined;
  }

  /**
   * Whether `moduleName` starts with `pattern`, where each `*` stands for
   * any run of characters.
   *
   * Matched segment by segment rather than through a regular expression: a
   * pattern is user input (`LOG_LEVEL`), and one made of many `*` sent a
   * backtracking engine into minutes of work each time a logger resolved its
   * level.
   */
  protected matchesPattern(moduleName: string, pattern: string): boolean {
    const [prefix, ...segments] = pattern.split("*");
    if (!moduleName.startsWith(prefix)) {
      return false;
    }
    let from = prefix.length;
    for (const segment of segments) {
      const at = moduleName.indexOf(segment, from);
      if (at === -1) {
        return false;
      }
      from = at + segment.length;
    }
    return true;
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
    const enabled = this.levels[level] <= this.levels[this.level];
    // A line below the level still feeds the `log:entry` event and the
    // request's LogBuffer (see below). With neither, nothing reads it, and
    // building, redacting and timestamping it was a few percent of a request
    // that logs one suppressed debug line.
    if (
      !enabled &&
      !this.alepha.events.hasListeners("log:entry") &&
      !this.alepha.context.get<LogBuffer>(LogBuffer.key)
    ) {
      return;
    }

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

    const span = this.span;
    if (span) {
      logEntry.traceId = span.traceId;
      logEntry.spanId = span.spanId;
    }

    // Captured before the level check, for the same reason the `log:entry` event is
    // emitted below it: an entry too verbose to print is exactly the kind of
    // breadcrumb worth having attached to an error report.
    this.alepha.context.get<LogBuffer>(LogBuffer.key)?.push(logEntry);

    if (!enabled) {
      // Suppressed for the console, but still EMITTED. Review #3 proposed
      // early-returning before building the entry; that would starve the
      // `log:entry` event, which is what feeds the devtools log viewer: a
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
   * as a substring, so `authorization`, `x-api-key`, `refreshToken` and
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

  protected static readonly TRUNCATED = "[truncated]";

  protected static readonly UNSERIALIZABLE = "[unserializable]";

  /**
   * How deep {@link redact} walks: an object or an array nested further is
   * replaced by {@link TRUNCATED}, so no payload can exhaust the stack.
   */
  protected static readonly REDACT_MAX_DEPTH = 100;

  /**
   * How many values one {@link redact} call writes, an object reached by two
   * paths counting twice. Once spent, each object or array still open ends
   * on {@link TRUNCATED}: without it, objects that share their children cost
   * and print one copy per path, which doubles at every level.
   */
  protected static readonly REDACT_MAX_VALUES = 10_000;

  /**
   * Verdicts of {@link isSecretKey}, by raw key.
   *
   * A logger sees the same handful of keys on every line (`method`, `path`,
   * `status`...), and the check costs a lowercase, a regex replace and one
   * `includes` per needle each time. Bounded, because a payload keyed by ids
   * would otherwise grow it forever: past the cap it starts over.
   */
  protected readonly secretKeyCache = new Map<string, boolean>();

  protected static readonly SECRET_KEY_CACHE_MAX = 512;

  /**
   * Whether a payload key names a credential, per {@link redactedKeys}.
   */
  protected isSecretKey(key: string): boolean {
    let secret = this.secretKeyCache.get(key);
    if (secret === undefined) {
      const normalized = key.toLowerCase().replace(/[-_]/g, "");
      secret = this.redactedKeys.some((needle) => normalized.includes(needle));
      if (this.secretKeyCache.size >= Logger.SECRET_KEY_CACHE_MAX) {
        this.secretKeyCache.clear();
      }
      this.secretKeyCache.set(key, secret);
    }
    return secret;
  }

  /**
   * Mask credential-bearing values anywhere in the log payload.
   *
   * Without this, a single `log.debug("request", { headers })` ships bearer
   * tokens and cookies to stdout, the log aggregator, and the devtools log
   * viewer. Structure and non-secret fields are preserved so the entry stays
   * useful for debugging.
   *
   * Errors and Dates are passed through untouched (formatters rely on the
   * instance). Logging must never throw, and a failure here must never hand
   * on what it was masking: data that cannot be read (a getter that throws)
   * is replaced as a whole by `{ redaction: "[unserializable]" }`.
   */
  protected redact(
    data: object | Error | undefined,
  ): object | Error | undefined {
    if (!data || data instanceof Error) {
      return data;
    }

    try {
      if (this.isFlatAndClean(data)) {
        return data;
      }
      return this.redactValue(
        data,
        { ancestors: new Set(), budget: Logger.REDACT_MAX_VALUES },
        0,
      ) as object;
    } catch {
      return { redaction: Logger.UNSERIALIZABLE };
    }
  }

  /**
   * The masked copy of `value`: an array as an array, any other object as a
   * plain object of its own enumerable fields.
   *
   * `walk.ancestors` holds the objects on the CURRENT path, as in
   * `JsonFormatterProvider.expandErrors`: a revisit on the path is a cycle
   * and writes `"[circular]"`, while an object shared by two branches is
   * written in both. {@link REDACT_MAX_DEPTH} and {@link REDACT_MAX_VALUES}
   * bound what that costs. The list of an object's own keys is still built
   * once, as `Object.entries` built it before; what is bounded is the work
   * past it: no value is read once the budget is spent. A typed array is
   * read by index, so its key list is never built.
   */
  protected redactValue(
    value: unknown,
    walk: RedactWalk,
    depth: number,
  ): unknown {
    walk.budget--;
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (value instanceof Error || value instanceof Date) {
      return value;
    }
    if (walk.ancestors.has(value)) {
      return "[circular]";
    }
    if (depth >= Logger.REDACT_MAX_DEPTH) {
      return Logger.TRUNCATED;
    }

    walk.ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const items: unknown[] = [];
        for (let index = 0; index < value.length; index++) {
          if (walk.budget <= 0) {
            items.push(Logger.TRUNCATED);
            break;
          }
          items.push(this.redactValue(value[index], walk, depth + 1));
        }
        return items;
      }

      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const indexed = ArrayBuffer.isView(value) && !(value instanceof DataView);
      const keys = indexed ? undefined : Object.keys(source);
      const length = keys
        ? keys.length
        : (value as unknown as ArrayLike<unknown>).length;
      for (let index = 0; index < length; index++) {
        const key = keys ? keys[index] : String(index);
        if (walk.budget <= 0) {
          out[Logger.TRUNCATED] = Logger.TRUNCATED;
          break;
        }
        if (this.isSecretKey(key)) {
          walk.budget--;
          out[key] = Logger.REDACTED;
        } else {
          out[key] = this.redactValue(source[key], walk, depth + 1);
        }
      }
      return out;
    } finally {
      walk.ancestors.delete(value);
    }
  }

  /**
   * Whether `data` is a plain object of primitives with no credential key:
   * the shape of most log lines (every request line is one), which the walk
   * in {@link redact} would copy key by key to change nothing.
   *
   * One with more keys than {@link REDACT_MAX_VALUES} is left to the walk,
   * which cuts it there.
   */
  protected isFlatAndClean(data: object): boolean {
    if (Object.getPrototypeOf(data) !== Object.prototype) {
      return false;
    }
    let keys = 0;
    for (const key in data) {
      if (++keys > Logger.REDACT_MAX_VALUES) {
        return false;
      }
      const value = (data as Record<string, unknown>)[key];
      if (value !== null && typeof value === "object") {
        return false;
      }
      if (this.isSecretKey(key)) {
        return false;
      }
    }
    return true;
  }

  protected emit(entry: LogEntry, message?: string) {
    // Most processes have no `log:entry` listener (devtools and telemetry add
    // one): skip the payload and the two promises an emit allocates.
    if (!this.alepha.events.hasListeners("log:entry")) {
      return;
    }
    this.alepha.events
      .emit(
        "log:entry",
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

/**
 * The state of one {@link Logger} redaction walk: the objects on the current
 * path, and the values left to write.
 */
interface RedactWalk {
  ancestors: Set<object>;
  budget: number;
}

/**
 * What the loggers of one container share about `alepha.logger.level`.
 */
interface LoggerLevelState {
  /**
   * The store value last met, and a counter that moves each time it changes:
   * a logger resolves its level again when the counter is not the one it saw.
   */
  current?: string;
  epoch: number;
  /**
   * The last value whose global level parsed.
   */
  valid?: string;
  /**
   * Why the global level of `current` does not parse, when it does not.
   */
  invalid?: string;
  /**
   * The refusals already logged for `current`.
   */
  reported: Set<string>;
}
