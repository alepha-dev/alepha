import { $inject, Alepha, run, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import type { CloudflareD1Provider } from "alepha/orm";
import {
  $entity,
  $repository,
  type D1Database,
  D1TimeoutProvider,
  DatabaseProvider,
  DbTimeoutError,
  db,
} from "alepha/orm";
import { $route } from "alepha/server";

/**
 * A live probe for the two D1 hardening features, deployed to a real Worker
 * against a real D1 database.
 *
 * Miniflare runs the same `workerd` build and covers the plumbing, but three
 * things only exist on the real thing: network latency to a primary in another
 * continent, actual read replicas, and the bookmark cookie surviving a real
 * browser round trip. This app exposes each as an endpoint so the claims can
 * be checked rather than asserted.
 *
 * The database primary is pinned to WNAM while the caller is in Europe, which
 * is Cloudflare's own suggestion for making replica routing observable.
 */
const notes = $entity({
  name: "lab_notes",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    title: z.text(),
  }),
});

class App {
  protected readonly alepha = $inject(Alepha);
  protected readonly provider = $inject(DatabaseProvider);
  protected readonly timeouts = $inject(D1TimeoutProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  notes = $repository(notes);

  /**
   * The raw binding, for the query metadata drizzle does not surface.
   * `served_by_primary` is the only honest way to tell a replica read from a
   * primary read.
   */
  protected binding(): D1Database {
    const env = this.alepha.get("cloudflare.env") as Record<string, unknown>;
    return env.DB as D1Database;
  }

  protected d1(): CloudflareD1Provider {
    return this.provider as CloudflareD1Provider;
  }

  /**
   * Where this read was served from, and the session state behind it.
   */
  status = $route({
    path: "/status",
    handler: async () => {
      const meta = await this.binding()
        .prepare("select count(*) as n from lab_notes")
        .all<{ n: number }>();

      return {
        sessionsEnabled: this.d1().sessionsEnabled(),
        bookmark: this.d1().sessionBookmark(),
        rows: meta.results?.[0]?.n ?? null,
        servedBy: {
          // false here is the whole point of read replication: a replica,
          // not the primary in Los Angeles, answered a European caller.
          primary: (meta.meta as any)?.served_by_primary ?? null,
          region: (meta.meta as any)?.served_by_region ?? null,
          colo: (meta.meta as any)?.served_by_colo ?? null,
        },
      } as any;
    },
  });

  /**
   * Writes a row, then reads it back in the same request.
   */
  write = $route({
    path: "/write",
    handler: async (request) => {
      const title = String(
        (request.url.searchParams.get("title") ?? "note") as string,
      );
      const created = await this.notes.create({ title });
      const readBack = await this.notes.findMany();

      return {
        created,
        count: readBack.length,
        bookmark: this.d1().sessionBookmark(),
      } as any;
    },
  });

  /**
   * Proves the ceiling on real infrastructure.
   *
   * The budget is deliberately far below the round trip to a primary on
   * another continent, so a real D1 query really does lose the race. Nothing
   * is simulated: this is the production wrapper around the production
   * binding.
   */
  timeoutProbe = $route({
    path: "/timeout-probe",
    handler: async (request) => {
      const budget = Number(request.url.searchParams.get("budget") ?? 1);
      const bounded = this.timeouts.wrap(this.binding(), budget);

      // `dateTime.nowMillis()`, never `Date.now()`: the project bans the
      // latter so time stays substitutable, and on Workers it is frozen
      // between I/O anyway.
      const started = this.dateTime.nowMillis();
      try {
        await bounded.prepare("select count(*) as n from lab_notes").all();
        return {
          budgetMs: budget,
          outcome: "completed",
          elapsedMs: this.dateTime.nowMillis() - started,
        } as any;
      } catch (error) {
        const timeout = DbTimeoutError.from(error);
        return {
          budgetMs: budget,
          outcome: timeout ? "timed-out" : "other-error",
          status: timeout?.status ?? null,
          message: (error as Error).message,
          elapsedMs: this.dateTime.nowMillis() - started,
        } as any;
      }
    },
  });
}

run(App);
