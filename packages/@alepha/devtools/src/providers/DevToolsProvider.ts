import { $hook, $inject, $store, Alepha, z } from "alepha";
import { JobService } from "alepha/api/jobs";
import { localEmailOptions } from "alepha/email";
import { $logger } from "alepha/logger";
import { RepositoryProvider } from "alepha/orm";
import { $route, ServerProvider } from "alepha/server";
import { $serve } from "alepha/server/static";
import { FileSystemProvider } from "alepha/system";

import { devtoolsAssets } from "../assets.ts";
import { devMetadataSchema } from "../schemas/DevMetadata.ts";
import { DevAtomLogProvider } from "./DevAtomLogProvider.ts";
import { DevLogStoreProvider } from "./DevLogStoreProvider.ts";
import { DevToolsMetadataProvider } from "./DevToolsMetadataProvider.ts";

export class DevToolsProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly metadataProvider = $inject(DevToolsMetadataProvider);
  protected readonly logStore = $inject(DevLogStoreProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly emailOptions = $store(localEmailOptions);
  protected readonly atomLog = $inject(DevAtomLogProvider);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.log.info("Devtools OK", {
        url: `${this.serverProvider.hostname}/__devtools/`,
      });
    },
  });

  protected readonly uiRoute = $serve({
    path: "/__devtools",
    root: devtoolsAssets.ui,
    historyApiFallback: true,
    silent: true,
  });

  protected readonly metadataRoute = $route({
    method: "GET",
    path: "/__devtools/api/metadata",
    silent: true,
    schema: {
      response: devMetadataSchema,
    },
    handler: () => {
      return this.metadataProvider.getMetadata();
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Session endpoint
  //
  // Whoever the *inspected application* currently considers the caller to be.
  // `ServerSecurityProvider` resolves `request.user` on every route, from
  // whichever channel authenticated it: the encrypted `tokens` cookie an
  // interactive login writes, a bearer header, or an API key. So devtools
  // needs no credential of its own. Logging in happens in the app; this only
  // reports the result.
  //
  // The response deliberately omits `token`. `schema.response` is what
  // serializes, so declaring the fields is also what stops the access token
  // reaching the browser.
  // -------------------------------------------------------------------------------------------------------------------

  protected readonly sessionRoute = $route({
    method: "GET",
    path: "/__devtools/api/session",
    silent: true,
    schema: {
      response: z.object({
        user: z
          .object({
            id: z.text(),
            name: z.text().optional(),
            email: z.text().optional(),
            username: z.text().optional(),
            picture: z.text().optional(),
            roles: z.array(z.text()).optional(),
            realm: z.text().optional(),
          })
          .optional(),
      }),
    },
    handler: ({ user }) => {
      if (!user) {
        // No security module loaded, or nobody signed in. Both are the same
        // answer to the only question the UI asks.
        return {};
      }

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          username: user.username,
          picture: user.picture,
          roles: user.roles,
          realm: user.realm,
        },
      };
    },
  });

  protected readonly updateAtomRoute = $route({
    method: "POST",
    path: "/__devtools/api/atoms",
    silent: true,
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
          // Every route runs inside a request context, and a plain `set`
          // writes into that context's fork: the value used to die with the
          // response while the UI reported "Saved". The app-level store is
          // the one being edited.
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
  });

  protected readonly atomLogRoute = $route({
    method: "GET",
    path: "/__devtools/api/atoms/log",
    silent: true,
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
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Logs endpoint
  // -------------------------------------------------------------------------------------------------------------------

  protected readonly logsRoute = $route({
    method: "GET",
    path: "/__devtools/api/logs",
    silent: true,
    schema: {
      query: z.object({
        level: z.text().optional(),
        type: z.text().optional(),
        module: z.text().optional(),
        search: z.text().optional(),
        /**
         * Sequence cursor: return only entries numbered strictly above this.
         *
         * A sequence rather than a timestamp because a millisecond holds many
         * entries, and this used to be `since=<ms>` compared with `>=`, which
         * the client had to send as `lastSeen + 1` to avoid re-delivering what
         * it already had - dropping every entry that shared that millisecond.
         */
        after: z.text().optional(),
        limit: z.text().optional(),
        offset: z.text().optional(),
        /**
         * Millisecond floor on a request's or query's own duration. Filtering
         * here rather than in the browser keeps the preset honest: the buffer
         * holds far more than the tail ever ships, so a client-side filter
         * would only find slow entries that happened to be on screen.
         */
        slowerThan: z.text().optional(),
      }),
      response: z.object({
        logs: z.array(z.any()),
        total: z.integer(),
        /**
         * More entries match the cursor than fit in this page. The tail polls
         * again straight away rather than waiting for its next tick, which is
         * what keeps a burst from being truncated to the newest `limit`.
         */
        hasMore: z.boolean(),
        /**
         * Entries the buffer itself evicted. Not "entries you missed": a
         * caught-up reader that never falls behind still sees this climb on a
         * busy day, and the view says so rather than implying a gap in what it
         * is showing.
         */
        dropped: z.integer(),
      }),
    },
    handler: ({ query }) => {
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
        logs: entries.map((e) => this.stripAnsiEntry(e)),
        total,
        hasMore,
        dropped: this.logStore.dropped(),
      };
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Email endpoint
  // -------------------------------------------------------------------------------------------------------------------

  protected readonly emailsRoute = $route({
    method: "GET",
    path: "/__devtools/api/emails",
    silent: true,
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
      }),
    },
    handler: async () => {
      try {
        const dir = this.emailOptions.directory;
        const exists = await this.fs.exists(dir);
        if (!exists) return { emails: [] };

        const files = await this.fs.ls(dir);
        const emailFiles = files.filter((f) => f.endsWith(".eml.json"));

        const emails: Array<{
          to: string;
          subject: string;
          body: string;
          sentAt: string;
        }> = [];

        for (const file of emailFiles) {
          try {
            const data = await this.fs.readJsonFile<{
              to: string;
              subject: string;
              body: string;
              sentAt: string;
            }>(this.fs.join(dir, file));
            emails.push(data);
          } catch {
            // skip malformed files
          }
        }

        emails.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
        return { emails };
      } catch {
        return { emails: [] };
      }
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // SMS endpoint
  // -------------------------------------------------------------------------------------------------------------------

  protected readonly smsRoute = $route({
    method: "GET",
    path: "/__devtools/api/sms",
    silent: true,
    schema: {
      response: z.object({
        messages: z.array(
          z.object({
            to: z.text(),
            message: z.string(),
            sentAt: z.text(),
          }),
        ),
      }),
    },
    handler: async () => {
      try {
        const dir = "node_modules/.alepha/sms";
        const exists = await this.fs.exists(dir);
        if (!exists) return { messages: [] };

        const files = await this.fs.ls(dir);
        const smsFiles = files.filter((f) => f.endsWith(".sms.json"));

        const messages: Array<{ to: string; message: string; sentAt: string }> =
          [];

        for (const file of smsFiles) {
          try {
            const data = await this.fs.readJsonFile<{
              to: string;
              message: string;
              sentAt: string;
            }>(this.fs.join(dir, file));
            messages.push(data);
          } catch {
            // skip malformed files
          }
        }

        messages.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
        return { messages };
      } catch {
        return { messages: [] };
      }
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Jobs — the runtime half
  //
  // The metadata response carries what `$job` declares; everything below is
  // execution state read from the durable outbox table. `JobService` already
  // assembles all of it for the admin API, so devtools reuses it rather than
  // re-deriving counts and status transitions.
  // -------------------------------------------------------------------------------------------------------------------

  protected readonly jobsRoute = $route({
    method: "GET",
    path: "/__devtools/api/jobs",
    silent: true,
    schema: { response: z.record(z.text(), z.any()) },
    handler: async () => {
      const service = this.getJobService();
      if (!service) return { jobs: [] };
      return { jobs: await service.listJobs() } as any;
    },
  });

  protected readonly jobExecutionsRoute = $route({
    method: "GET",
    path: "/__devtools/api/jobs/:name/executions",
    silent: true,
    schema: {
      params: z.object({ name: z.text() }),
      query: z.object({ status: z.text().optional() }),
      response: z.record(z.text(), z.any()),
    },
    /**
     * Wrapped in an envelope: `getExecutions` resolves to an array, and a
     * route declaring a record answers 500 ("expected record, received
     * array") — the same shape of bug the DELETE endpoint had.
     */
    handler: async ({ params, query }) => {
      const service = this.getJobService();
      if (!service) return { executions: [] };
      const result = await service.getExecutions(
        params.name,
        (query.status ? { status: query.status } : {}) as any,
      );
      return {
        executions: Array.isArray(result)
          ? result
          : ((result as any)?.content ?? []),
      } as any;
    },
  });

  protected readonly jobExecutionRoute = $route({
    method: "GET",
    path: "/__devtools/api/jobs/executions/:id",
    silent: true,
    schema: {
      params: z.object({ id: z.text() }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params }) => {
      const service = this.getJobService();
      if (!service) return { error: "Jobs module not loaded" };
      return ((await service.getExecution(params.id)) ?? {}) as any;
    },
  });

  protected readonly jobTriggerRoute = $route({
    method: "POST",
    path: "/__devtools/api/jobs/:name/trigger",
    silent: true,
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
  });

  protected readonly jobRetryRoute = $route({
    method: "POST",
    path: "/__devtools/api/jobs/executions/:id/retry",
    silent: true,
    schema: {
      params: z.object({ id: z.text() }),
      response: z.record(z.text(), z.any()),
    },
    handler: async ({ params }) => {
      const service = this.getJobService();
      if (!service) return { error: "Jobs module not loaded" };
      return ((await service.retryExecution(params.id)) ?? { ok: true }) as any;
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // DB CRUD endpoints
  // -------------------------------------------------------------------------------------------------------------------

  protected readonly dbListRoute = $route({
    method: "GET",
    path: "/__devtools/api/db/:entity/records",
    silent: true,
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
  });

  protected readonly dbCreateRoute = $route({
    method: "POST",
    path: "/__devtools/api/db/:entity/records",
    silent: true,
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
  });

  protected readonly dbUpdateRoute = $route({
    method: "PUT",
    path: "/__devtools/api/db/:entity/records/:id",
    silent: true,
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
  });

  protected readonly dbDeleteRoute = $route({
    method: "DELETE",
    path: "/__devtools/api/db/:entity/records/:id",
    silent: true,
    schema: {
      params: z.object({ entity: z.text(), id: z.text() }),
      response: z.record(z.text(), z.any()),
    },
    /**
     * `deleteById` resolves to the deleted rows — an array — while the
     * response was declared as a record, so every delete answered 500
     * ("expected record, received array") *after* removing the row. The client
     * saw a failure, kept the deleted record selected, and never refreshed.
     *
     * A stable `{ deleted, id }` envelope is returned instead of the driver's
     * own shape, so the contract no longer depends on what the ORM happens to
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
  });

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Strip ANSI escape sequences from a log entry before serving it.
   *
   * Under `LOG_FORMAT=pretty` some call sites colourise values inside the
   * message itself (`Listening on ${cyan(url)}`). A terminal renders that;
   * the devtools UI is HTML, so the raw codes leak through as
   * `Listening on [36mhttp://…[0m`. The buffer keeps the original — only the
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
