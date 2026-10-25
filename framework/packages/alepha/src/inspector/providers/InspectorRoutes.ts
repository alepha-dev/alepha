import { $inject, $store, Alepha, z } from "alepha";
import { JobService } from "alepha/api/jobs";
import { localEmailOptions } from "alepha/email";
import { $logger, JsonFormatterProvider } from "alepha/logger";
import { RepositoryProvider } from "alepha/orm";
import { localSmsOptions } from "alepha/sms";
import { FileSystemProvider } from "alepha/system";

import { INSPECTOR_ENDPOINTS } from "../constants/INSPECTOR_ENDPOINTS.ts";
import type {
  InspectorMethod,
  InspectorRoute,
  InspectorRouteSchema,
} from "../interfaces/InspectorRoute.ts";
import { devMetadataSchema } from "../schemas/DevMetadata.ts";
import { DevAtomLogProvider } from "./DevAtomLogProvider.ts";
import { DevLogStoreProvider } from "./DevLogStoreProvider.ts";
import { DevToolsMetadataProvider } from "./DevToolsMetadataProvider.ts";

/**
 * The inspector protocol: every endpoint a tool can call on a running app.
 *
 * A plain table of `{ method, path, schema, handler }`, not `$route`s. The
 * per-process socket serves it, the typed client is derived from it, and
 * until the in-app devtools goes, an adapter also mounts it on the app server
 * under `/__devtools/api`. Keeping it free of `$route` is what lets one table
 * feed all three.
 *
 * SECURITY: these endpoints read and MUTATE application state (arbitrary DB
 * writes, atom writes, job triggers) and serve the environment, secrets
 * included, in cleartext. They are unauthenticated by design, which is why
 * the module that registers them refuses production unless explicitly opted
 * into, and why the transport is a `0600` socket rather than a TCP port.
 */
export class InspectorRoutes {
  // Method and path of each route come from `INSPECTOR_ENDPOINTS`, which the
  // client reads too; the keys here are the same names.
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly metadataProvider = $inject(DevToolsMetadataProvider);
  protected readonly logStore = $inject(DevLogStoreProvider);
  protected readonly atomLog = $inject(DevAtomLogProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly json = $inject(JsonFormatterProvider);
  protected readonly emailOptions = $store(localEmailOptions);
  protected readonly smsOptions = $store(localSmsOptions);

  public readonly routes = {
    metadata: this.route({
      ...INSPECTOR_ENDPOINTS.metadata,
      schema: {
        response: devMetadataSchema,
      },
      handler: () => this.metadataProvider.getMetadata(),
    }),

    updateAtom: this.route({
      ...INSPECTOR_ENDPOINTS.updateAtom,
      schema: {
        body: z.object({
          name: z.text(),
          value: z.any(),
        }),
        response: z.object({
          success: z.boolean(),
          message: z.text().optional(),
        }),
      },
      handler: ({ body }) => {
        const atoms = this.alepha.store.getAtoms(false);
        const atomEntry = atoms.find((a) => a.atom.key === body.name);

        if (atomEntry) {
          try {
            // A transport may run the handler inside a request context, and a
            // plain `set` writes into that context's fork: the value used to
            // die with the response while the UI reported "Saved". The
            // app-level store is the one being edited.
            this.alepha.store.set(atomEntry.atom, body.value, {
              skipContext: true,
            });
            return { success: true };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.log.warn(`Failed to update atom "${body.name}"`, { error });
            return { success: false, message };
          }
        }

        return { success: false, message: `Unknown atom "${body.name}"` };
      },
    }),

    atomLog: this.route({
      ...INSPECTOR_ENDPOINTS.atomLog,
      schema: {
        query: z.object({
          key: z.text().optional(),
        }),
        response: z.object({
          entries: z.array(z.any()),
          total: z.integer(),
        }),
      },
      handler: ({ query }) => {
        const entries = this.atomLog.entries(query.key);
        return { entries: entries.slice(0, 100) as any, total: entries.length };
      },
    }),

    logs: this.route({
      ...INSPECTOR_ENDPOINTS.logs,
      schema: {
        query: z.object({
          level: z.text().optional(),
          type: z.text().optional(),
          module: z.text().optional(),
          search: z.text().optional(),
          /**
           * Sequence cursor: return only entries numbered strictly above this.
           *
           * A sequence rather than a timestamp because a millisecond holds
           * many entries, and this used to be `since=<ms>` compared with `>=`,
           * which the client had to send as `lastSeen + 1` to avoid
           * re-delivering what it already had - dropping every entry that
           * shared that millisecond.
           */
          after: z.text().optional(),
          limit: z.text().optional(),
          offset: z.text().optional(),
          /**
           * Millisecond floor on a request's or query's own duration.
           * Filtering here rather than in the browser keeps the preset
           * honest: the buffer holds far more than the tail ever ships, so a
           * client-side filter would only find slow entries that happened to
           * be on screen.
           */
          slowerThan: z.text().optional(),
        }),
        response: z.object({
          logs: z.array(z.any()),
          total: z.integer(),
          /**
           * More entries match the cursor than fit in this page. The tail
           * polls again straight away rather than waiting for its next tick,
           * which is what keeps a burst from being truncated to the newest
           * `limit`.
           */
          hasMore: z.boolean(),
          /**
           * Entries the buffer itself evicted. Not "entries you missed": a
           * caught-up reader that never falls behind still sees this climb on
           * a busy day, and the view says so rather than implying a gap in
           * what it is showing.
           */
          dropped: z.integer(),
        }),
      },
      handler: ({ query }) => this.readLogs(query),
    }),

    emails: this.route({
      ...INSPECTOR_ENDPOINTS.emails,
      schema: {
        response: z.object({
          emails: z.array(
            z.object({
              to: z.text(),
              subject: z.text(),
              body: z.string(),
              sentAt: z.text(),
            }),
          ),
          /**
           * Where these were read from. The view used to print the default
           * path as a literal, which is wrong the moment `DATA_DIR` moves it,
           * and that path is the whole point of the footer: it is what you
           * need when you go looking outside devtools.
           */
          directory: z.text({ size: "long" }),
        }),
      },
      handler: async () => {
        const dir = this.emailOptions.directory;
        const emails = await this.readOutbox<{
          to: string;
          subject: string;
          body: string;
          sentAt: string;
        }>(dir, ".eml.json");
        return { emails, directory: dir };
      },
    }),

    sms: this.route({
      ...INSPECTOR_ENDPOINTS.sms,
      schema: {
        response: z.object({
          messages: z.array(
            z.object({
              to: z.text(),
              message: z.string(),
              sentAt: z.text(),
            }),
          ),
          /**
           * Where these were read from - `localSmsOptions`, not the default
           * spelled out a second time. An app that moved its outbox used to
           * see an empty screen here with no hint as to why.
           */
          directory: z.text({ size: "long" }),
        }),
      },
      handler: async () => {
        const dir = this.smsOptions.directory;
        const messages = await this.readOutbox<{
          to: string;
          message: string;
          sentAt: string;
        }>(dir, ".sms.json");
        return { messages, directory: dir };
      },
    }),

    // -----------------------------------------------------------------------------------------------------------------
    // Jobs: the runtime half
    //
    // The metadata response carries what `$job` declares; everything below is
    // execution state read from the durable outbox table. `JobService` already
    // assembles all of it for the admin API, so the inspector reuses it rather
    // than re-deriving counts and status transitions.
    // -----------------------------------------------------------------------------------------------------------------

    jobs: this.route({
      ...INSPECTOR_ENDPOINTS.jobs,
      schema: { response: z.record(z.text(), z.any()) },
      handler: async () => {
        const service = this.getJobService();
        if (!service) return { jobs: [] };
        return { jobs: await service.listJobs() } as any;
      },
    }),

    // Declared before `/jobs/:name/executions`, which it would otherwise
    // shadow for a job literally named "executions".
    jobExecution: this.route({
      ...INSPECTOR_ENDPOINTS.jobExecution,
      schema: {
        params: z.object({ id: z.text() }),
        response: z.record(z.text(), z.any()),
      },
      handler: async ({ params }) => {
        const service = this.getJobService();
        if (!service) return { error: "Jobs module not loaded" };
        return ((await service.getExecution(params.id)) ?? {}) as any;
      },
    }),

    jobExecutions: this.route({
      ...INSPECTOR_ENDPOINTS.jobExecutions,
      schema: {
        params: z.object({ name: z.text() }),
        query: z.object({ status: z.text().optional() }),
        response: z.record(z.text(), z.any()),
      },
      /**
       * Wrapped in an envelope: `getExecutions` resolves to an array, and a
       * route declaring a record answers 500 ("expected record, received
       * array"), the same shape of bug the DELETE endpoint had.
       */
      handler: async ({ params, query }) => {
        const service = this.getJobService();
        if (!service) return { executions: [] };
        // The newest hundred, the most one page holds.
        const result = await service.getExecutions(params.name, {
          size: 100,
          ...(query.status ? { status: [query.status as any] } : {}),
        });
        return {
          executions: Array.isArray(result)
            ? result
            : ((result as any)?.content ?? []),
        } as any;
      },
    }),

    jobTrigger: this.route({
      ...INSPECTOR_ENDPOINTS.jobTrigger,
      schema: {
        params: z.object({ name: z.text() }),
        body: z.record(z.text(), z.any()),
        response: z.record(z.text(), z.any()),
      },
      handler: async ({ params, body }) => {
        const service = this.getJobService();
        if (!service) return { error: "Jobs module not loaded" };
        return ((await service.triggerJob(params.name, body as any)) ?? {
          ok: true,
        }) as any;
      },
    }),

    jobRetry: this.route({
      ...INSPECTOR_ENDPOINTS.jobRetry,
      schema: {
        params: z.object({ id: z.text() }),
        response: z.record(z.text(), z.any()),
      },
      handler: async ({ params }) => {
        const service = this.getJobService();
        if (!service) return { error: "Jobs module not loaded" };
        return ((await service.retryExecution(params.id)) ?? {
          ok: true,
        }) as any;
      },
    }),

    // -----------------------------------------------------------------------------------------------------------------
    // Database rows
    // -----------------------------------------------------------------------------------------------------------------

    dbList: this.route({
      ...INSPECTOR_ENDPOINTS.dbList,
      schema: {
        params: z.object({ entity: z.text() }),
        query: z.object({
          page: z.text().optional(),
          size: z.text().optional(),
          sort: z.text().optional(),
        }),
        response: z.record(z.text(), z.any()),
      },
      handler: async ({ params, query }) => {
        const repo = this.getRepository(params.entity);
        if (!repo) {
          return { content: [], page: { totalElements: 0 } };
        }

        return repo.paginate(
          {
            page: query.page ? Number(query.page) : 0,
            size: query.size ? Number(query.size) : 50,
            sort: query.sort || undefined,
          },
          {},
          { count: true },
        ) as any;
      },
    }),

    dbCreate: this.route({
      ...INSPECTOR_ENDPOINTS.dbCreate,
      schema: {
        params: z.object({ entity: z.text() }),
        body: z.record(z.text(), z.any()),
        response: z.record(z.text(), z.any()),
      },
      handler: async ({ params, body }) => {
        const repo = this.getRepository(params.entity);
        if (!repo) {
          return { error: "Entity not found" };
        }
        return repo.create(body) as any;
      },
    }),

    dbUpdate: this.route({
      ...INSPECTOR_ENDPOINTS.dbUpdate,
      schema: {
        params: z.object({ entity: z.text(), id: z.text() }),
        body: z.record(z.text(), z.any()),
        response: z.record(z.text(), z.any()),
      },
      handler: async ({ params, body }) => {
        const repo = this.getRepository(params.entity);
        if (!repo) {
          return { error: "Entity not found" };
        }

        const idValue = this.parseId(repo, params.id);
        return repo.updateById(idValue, body) as any;
      },
    }),

    dbDelete: this.route({
      ...INSPECTOR_ENDPOINTS.dbDelete,
      schema: {
        params: z.object({ entity: z.text(), id: z.text() }),
        response: z.record(z.text(), z.any()),
      },
      /**
       * `deleteById` resolves to the deleted rows (an array) while the
       * response is declared as a record, so every delete used to answer 500
       * ("expected record, received array") *after* removing the row. A stable
       * `{ deleted, id }` envelope is returned instead of the driver's own
       * shape, so the contract no longer depends on what the ORM happens to
       * resolve to.
       */
      handler: async ({ params }) => {
        const repo = this.getRepository(params.entity);
        if (!repo) {
          return { deleted: 0, error: "Entity not found" };
        }

        const idValue = this.parseId(repo, params.id);
        const result = await repo.deleteById(idValue);
        const deleted = Array.isArray(result) ? result.length : result ? 1 : 0;

        return { deleted, id: params.id };
      },
    }),
  };

  /**
   * Every route, in declaration order. Order matters to a matcher: a static
   * segment is declared before a parameter that would capture it.
   */
  public list(): InspectorRoute[] {
    return Object.values(this.routes) as unknown as InspectorRoute[];
  }

  /**
   * The route a request targets, with its path parameters, or `undefined`.
   *
   * `pathname` is relative to the transport's base (`/jobs/send/executions`).
   */
  public match(
    method: string,
    pathname: string,
  ): { route: InspectorRoute; params: Record<string, string> } | undefined {
    const segments = this.segments(pathname);
    const upper = method.toUpperCase();

    for (const route of this.list()) {
      if (route.method !== upper) continue;

      const pattern = this.segments(route.path);
      if (pattern.length !== segments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < pattern.length; i++) {
        const expected = pattern[i];
        const actual = segments[i];
        if (expected.startsWith(":")) {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { route, params };
      }
    }

    return undefined;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Identity, for inference: each route keeps its own schema type, which is
   * what the typed client reads.
   */
  protected route<T extends InspectorRouteSchema>(
    route: InspectorRoute<T> & { method: InspectorMethod },
  ): InspectorRoute<T> {
    return route;
  }

  protected segments(path: string): string[] {
    return path.split("/").filter(Boolean);
  }

  protected readLogs(query: {
    level?: string;
    type?: string;
    module?: string;
    search?: string;
    after?: string;
    limit?: string;
    offset?: string;
    slowerThan?: string;
  }) {
    const levelOrder = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];
    // The previous run's restored tail, then this one's. See
    // `DevLogStoreProvider`: the two are kept apart so a busy session cannot
    // evict the crash you restarted in order to read.
    let entries = this.logStore.entries();

    if (query.level) {
      const minIndex = levelOrder.indexOf(query.level.toUpperCase());
      if (minIndex >= 0) {
        entries = entries.filter(
          (e) => levelOrder.indexOf(e.level) >= minIndex,
        );
      }
    }

    if (query.type) {
      const types = query.type.split(",").map((t) => t.trim());
      entries = entries.filter((e) => {
        if (!e.data || typeof e.data !== "object") return false;
        const d = e.data as Record<string, unknown>;
        for (const t of types) {
          if (t === "http" || t === "http:request") {
            // `duration` can round to 0 and still be an HTTP entry.
            if (
              d.status &&
              d.method &&
              d.path &&
              typeof d.duration === "number"
            )
              return true;
          } else if (t === "db" || t === "db:query") {
            if (d.type === "db:query") return true;
          } else if (d.type === t) {
            return true;
          }
        }
        return false;
      });
    }

    if (query.slowerThan) {
      const floor = Number(query.slowerThan);
      if (Number.isFinite(floor)) {
        entries = entries.filter((e) => {
          const duration = (e.data as Record<string, unknown> | undefined)
            ?.duration;
          return typeof duration === "number" && duration >= floor;
        });
      }
    }

    if (query.module) {
      entries = entries.filter((e) => e.module === query.module);
    }

    if (query.search) {
      const terms = query.search.toLowerCase().split(/\s+/);
      entries = entries.filter((e) => {
        const text = `${e.message} ${e.module} ${e.service}`.toLowerCase();
        return terms.every((term) => text.includes(term));
      });
    }

    const after = query.after === undefined ? undefined : Number(query.after);
    const tailing = after !== undefined && !Number.isNaN(after);
    if (tailing) {
      entries = entries.filter((e) => e.seq > after);
    }

    const total = entries.length;

    const offset = query.offset ? Number(query.offset) : 0;
    const limit = query.limit ? Number(query.limit) : 100;

    let hasMore = false;
    if (tailing) {
      // Catch-up: the OLDEST unseen page, not the newest.
      //
      // Reversing first and slicing after is what silently skipped bursts. A
      // thousand entries with `limit=200` shipped the newest 200 and left the
      // client's cursor past the other 800, which no later poll could ask
      // for: the cursor only moves forward. Handing back the oldest page and
      // saying `hasMore` lets the tail walk the whole burst in order.
      hasMore = entries.length > limit;
      entries = entries.slice(0, limit).toReversed();
    } else {
      // First load: the newest window, which is what a tail opens on.
      entries = entries.toReversed().slice(offset, offset + limit);
    }

    return {
      logs: entries.map((e) => this.serializeEntry(e)),
      total,
      hasMore,
      dropped: this.logStore.dropped(),
    };
  }

  /**
   * Every `*<suffix>` file of a local outbox directory, newest first.
   * Malformed files are skipped, and a missing directory is an empty outbox.
   */
  protected async readOutbox<T extends { sentAt: string }>(
    dir: string,
    suffix: string,
  ): Promise<T[]> {
    try {
      if (!(await this.fs.exists(dir))) return [];

      const files = (await this.fs.ls(dir)).filter((f) => f.endsWith(suffix));
      const items: T[] = [];

      for (const file of files) {
        try {
          items.push(await this.fs.readJsonFile<T>(this.fs.join(dir, file)));
        } catch {
          // skip malformed files
        }
      }

      items.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
      return items;
    } catch {
      return [];
    }
  }

  /**
   * A log entry as it crosses the wire: colour codes stripped, errors
   * expanded (an Error serializes as `{}`), and the first error's stack lifted
   * to `stack`, which the log panel renders as a trace.
   */
  protected serializeEntry<T extends { message?: string; data?: unknown }>(
    entry: T,
  ): T & { stack?: string } {
    const data = this.json.serializeData(entry.data);
    const stack = this.stackOf(data);
    return {
      ...this.stripAnsiEntry(entry),
      data,
      ...(stack ? { stack } : {}),
    };
  }

  /**
   * The stack of the error a log entry carries: its `data` itself, or one of
   * its values (`log.error("...", { error })`), already serialized.
   */
  protected stackOf(data: unknown): string | undefined {
    if (!data || typeof data !== "object") return undefined;
    const own = (data as { stack?: unknown }).stack;
    if (typeof own === "string") return own;
    for (const value of Object.values(data)) {
      const nested = (value as { stack?: unknown } | null)?.stack;
      if (typeof nested === "string") return nested;
    }
    return undefined;
  }

  /**
   * Strip ANSI escape sequences from a log entry before serving it.
   *
   * Under `LOG_FORMAT=pretty` some call sites colourise values inside the
   * message itself (`Listening on ${cyan(url)}`). A terminal renders that;
   * the devtools UI is HTML, so the raw codes leak through as
   * `Listening on [36mhttp://...[0m`. The buffer keeps the original; only the
   * served copy is cleaned.
   */
  protected stripAnsiEntry<T extends { message?: string }>(entry: T): T {
    if (typeof entry?.message !== "string") {
      return entry;
    }
    return { ...entry, message: this.stripAnsi(entry.message) };
  }

  protected stripAnsi(value: string): string {
    // Matches CSI SGR sequences (ESC [ ... m), the colour codes the pretty
    // formatter emits. Written as \u001b rather than a literal control
    // byte so the source stays readable and copy-paste safe.
    return value.replace(/\u001b\[[0-9;]*m/g, "");
  }

  /**
   * `JobService`, or `undefined` when the application never loaded the jobs
   * module. Guarded the same way the repository lookup is: the container
   * refuses to register a provider after start, so an app without jobs must
   * degrade to an empty list rather than 500 every job route.
   */
  protected getJobService(): JobService | undefined {
    try {
      return this.alepha.inject(JobService);
    } catch {
      return undefined;
    }
  }

  protected getRepository(entityName: string) {
    try {
      const repositoryProvider = this.alepha.inject(RepositoryProvider);
      const repos = repositoryProvider.getRepositories();
      return repos.find((r) => r.entity.name === entityName);
    } catch {
      return undefined;
    }
  }

  protected parseId(repo: any, rawId: string): string | number {
    const idType = repo.id.type;
    if (idType?.type === "integer" || idType?.type === "number") {
      return Number(rawId);
    }
    return rawId;
  }
}
