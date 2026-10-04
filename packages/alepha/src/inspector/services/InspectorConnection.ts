import { request as httpRequest } from "node:http";

import { AlephaError } from "alepha";
import type { DateTimeProvider } from "alepha/datetime";
import type { LogEntry } from "alepha/logger";

import { INSPECTOR_ENDPOINTS } from "../constants/INSPECTOR_ENDPOINTS.ts";
import type {
  InspectorCallRequest,
  InspectorCallResponse,
  InspectorRouteName,
} from "../interfaces/InspectorCall.ts";
import type { InspectorRun } from "../schemas/InspectorRun.ts";
import type { InspectorRegistry } from "./InspectorRegistry.ts";

/**
 * A log entry as the inspector serves it: numbered, so a reader can resume.
 */
export type InspectorLogEntry = LogEntry & { seq: number };

export interface InspectorTailOptions {
  /**
   * Minimum level: `TRACE`, `DEBUG`, `INFO`, `WARN` or `ERROR`.
   */
  level?: string;
  /**
   * How long to wait between two polls once caught up, in milliseconds.
   *
   * @default 1000
   */
  intervalMs?: number;
  /**
   * How many of the entries already logged to deliver first, before
   * following. `0` follows from now on.
   *
   * @default 0
   */
  history?: number;
  /**
   * Stops the tail; the iterator then returns.
   */
  signal?: AbortSignal;
}

/**
 * A client for one run, over its Unix socket. Made by
 * `InspectorClient.connect()`, which has already checked the protocol.
 *
 * A dead run has no socket: only its logs are readable, straight from the
 * file the process left behind.
 */
export class InspectorConnection {
  public readonly run: InspectorRun;
  protected readonly registry: InspectorRegistry;
  protected readonly dateTime: DateTimeProvider;

  public constructor(
    run: InspectorRun,
    registry: InspectorRegistry,
    dateTime: DateTimeProvider,
  ) {
    this.run = run;
    this.registry = registry;
    this.dateTime = dateTime;
  }

  /**
   * Call one route by name. Typed from the route table: the request parts
   * and the response are the route's own schemas.
   *
   * @throws AlephaError when the run is dead, the socket refuses, or the
   * route answers a status of 400 or more.
   */
  public async call<K extends InspectorRouteName>(
    name: K,
    request: InspectorCallRequest<K> = {},
  ): Promise<InspectorCallResponse<K>> {
    if (this.run.status === "dead") {
      throw new AlephaError(
        `Run "${this.run.name}" (${this.run.runId}) is dead: only its logs are readable, through logs() or tail().`,
      );
    }

    const endpoint = INSPECTOR_ENDPOINTS[name];
    const path = this.path(
      endpoint.path,
      request.params as Record<string, unknown> | undefined,
      request.query as Record<string, unknown> | undefined,
    );

    const response = await this.send(endpoint.method, path, request.body);
    if (response.status >= 400) {
      const message =
        (response.body as { message?: string } | undefined)?.message ??
        "no message";
      throw new AlephaError(
        `Inspector ${endpoint.method} ${path} answered ${response.status}: ${message}`,
      );
    }

    return response.body as InspectorCallResponse<K>;
  }

  /**
   * One page of logs, newest first: from the socket when the run is live,
   * from its log file when it is dead.
   */
  public async logs(
    query: InspectorCallRequest<"logs">["query"] = {},
  ): Promise<InspectorCallResponse<"logs">> {
    if (this.run.status === "live") {
      return this.call("logs", { query });
    }

    const limit = query.limit ? Number(query.limit) : 100;
    const entries = await this.registry.readLogFile(this.run, {
      limit: Number.MAX_SAFE_INTEGER,
    });
    const filtered = this.filterLevel(entries, query.level).map((entry) =>
      this.stripAnsi(entry),
    );
    return {
      logs: filtered.slice(0, limit),
      total: filtered.length,
      hasMore: false,
      dropped: 0,
    };
  }

  /**
   * Follow the run's logs, oldest first, as an async iterator.
   *
   * Cursor polling on the same `?after=<seq>` endpoint the devtools UI uses:
   * a burst is drained page by page before waiting again, so nothing is
   * skipped. The iterator returns when the signal aborts or the run goes
   * away; a dead run yields its log file once and returns.
   */
  public async *tail(
    options: InspectorTailOptions = {},
  ): AsyncGenerator<InspectorLogEntry> {
    const intervalMs = options.intervalMs ?? 1000;

    if (this.run.status === "dead") {
      const page = await this.logs({
        level: options.level,
        limit: String(options.history ?? Number.MAX_SAFE_INTEGER),
      });
      yield* (page.logs as InspectorLogEntry[]).toReversed();
      return;
    }

    let cursor: number;
    try {
      const opening = await this.logs({
        level: options.level,
        limit: String(Math.max(options.history ?? 0, 1)),
      });
      const newest = opening.logs as InspectorLogEntry[];
      // Restored history carries negative numbers, so "nothing seen yet" is
      // below every one of them.
      cursor = newest[0]?.seq ?? Number.MIN_SAFE_INTEGER;
      if (options.history) {
        yield* newest.toReversed();
      }
    } catch (error) {
      if (this.isGone(error)) return;
      throw error;
    }

    while (!options.signal?.aborted) {
      let page: InspectorCallResponse<"logs">;
      try {
        page = await this.logs({
          level: options.level,
          after: String(cursor),
          limit: "200",
        });
      } catch (error) {
        if (this.isGone(error)) return;
        throw error;
      }

      // Each page is newest first: hand it over in log order.
      for (const entry of (page.logs as InspectorLogEntry[]).toReversed()) {
        cursor = Math.max(cursor, entry.seq);
        yield entry;
        if (options.signal?.aborted) return;
      }

      if (!page.hasMore) {
        await this.dateTime.wait(intervalMs, { signal: options.signal });
      }
    }
  }

  /**
   * One request by method and path, answered as is: the status and the JSON
   * body, whatever they are. For a proxy, which forwards rather than calls;
   * a tool calling a known route wants `call()`.
   *
   * @throws AlephaError when the socket cannot be reached.
   */
  public request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    return this.send(method, path, body);
  }

  /**
   * Whether an error from `request()` or `call()` means the run is gone:
   * its socket is missing or refuses.
   */
  public isGone(error: unknown): boolean {
    const code = ((error as { cause?: { code?: string } })?.cause ?? {}).code;
    return code === "ENOENT" || code === "ECONNREFUSED";
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected path(
    pattern: string,
    params: Record<string, unknown> = {},
    query: Record<string, unknown> = {},
  ): string {
    const path = pattern.replace(/:(\w+)/g, (_, key: string) => {
      const value = params[key];
      if (value === undefined) {
        throw new AlephaError(`Missing path parameter "${key}" for ${pattern}`);
      }
      return encodeURIComponent(this.text(value));
    });

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) search.set(key, this.text(value));
    }
    const qs = search.toString();
    return qs ? `${path}?${qs}` : path;
  }

  /**
   * A path or query value as text. They are strings, numbers or booleans by
   * their schemas; anything else is sent as JSON rather than `[object Object]`.
   */
  protected text(value: unknown): string {
    return typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  }

  protected send(
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(
        {
          socketPath: this.run.socketPath,
          method,
          path,
          headers: payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }
            : {},
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode ?? 0,
                body: data ? JSON.parse(data) : undefined,
              });
            } catch (error) {
              reject(
                new AlephaError(`Inspector ${method} ${path}: invalid JSON`, {
                  cause: error,
                }),
              );
            }
          });
        },
      );
      req.on("error", (error) =>
        reject(
          new AlephaError(
            `Cannot reach run "${this.run.name}" (${this.run.runId}) at ${this.run.socketPath}`,
            { cause: error },
          ),
        ),
      );
      if (payload) req.write(payload);
      req.end();
    });
  }

  protected filterLevel(
    entries: InspectorLogEntry[],
    level?: string,
  ): InspectorLogEntry[] {
    const order = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];
    const min = level ? order.indexOf(level.toUpperCase()) : -1;
    if (min < 0) return entries;
    return entries.filter((entry) => order.indexOf(entry.level) >= min);
  }

  /**
   * The same cleaning the `/logs` route applies: a log file keeps the colour
   * codes the pretty formatter put in messages.
   */
  protected stripAnsi(entry: InspectorLogEntry): InspectorLogEntry {
    return typeof entry.message === "string"
      ? { ...entry, message: entry.message.replace(/\u001b\[[0-9;]*m/g, "") }
      : entry;
  }
}
