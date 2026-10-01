import type { PgAsyncDatabase } from "drizzle-orm/pg-core";

/**
 * The Cloudflare D1 binding surface, declared here rather than pulled from
 * `@cloudflare/workers-types` so the ORM keeps building off-Workers.
 *
 * These types used to live inside `CloudflareD1Provider`. They moved here so
 * `D1TimeoutProvider` can wrap a binding without importing the provider that
 * consumes it, which would have closed a module cycle the build's analyze
 * step rejects. `CloudflareD1Provider` re-exports them, so existing imports
 * keep working.
 */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
  exec(query: string): Promise<D1ExecResult>;
  dump(): Promise<ArrayBuffer>;

  /**
   * Opens a D1 session, the entry point to read replication.
   *
   * Optional because it is absent on older `workerd` builds and on the
   * hand-rolled fakes in the test suite. Read replication does nothing
   * without it: Cloudflare routes every query to the primary unless the
   * caller goes through a session.
   */
  withSession?(
    constraintOrBookmark?: (D1SessionBookmark & {}) | D1SessionConstraint,
  ): D1DatabaseSession;
}

/**
 * A session is a strict subset of the binding: `prepare` and `batch`, plus
 * the bookmark accessor. That is exactly what `drizzle-orm/d1` calls on a
 * binding, which is why `drizzle(session)` is a drop-in.
 */
export interface D1DatabaseSession {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
  getBookmark(): D1SessionBookmark | null;
}

/**
 * An opaque marker naming a point in the database's history. Handing it back
 * on the next request is what buys sequential consistency across requests.
 */
export type D1SessionBookmark = string;

/**
 * `first-unconstrained` takes whichever replica answers fastest and is the
 * right default for a first request with no bookmark. `first-primary` forces
 * the primary, which is what you want immediately after a write when no
 * bookmark is available.
 */
export type D1SessionConstraint = "first-unconstrained" | "first-primary";

/**
 * The session serving one async context, plus the drizzle instance bound to
 * it.
 *
 * Both are kept: queries need the drizzle instance, and handing the bookmark
 * back at the end of the request needs the session itself, which drizzle does
 * not expose once it has wrapped it.
 */
export interface D1SessionState {
  session: D1DatabaseSession;
  db: PgAsyncDatabase<any>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    duration: number;
    changes: number;
    last_row_id: number;
    served_by: string;
    internal_stats: unknown;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}
