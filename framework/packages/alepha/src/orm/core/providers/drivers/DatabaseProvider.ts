import { stat } from "node:fs/promises";

import {
  $inject,
  Alepha,
  AlephaError,
  type Infer,
  TimeoutError,
  type ZObject,
} from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { type SQL, sql } from "drizzle-orm";
import {
  alias,
  type PgAsyncDatabase,
  type PgAsyncTransaction,
  type PgTableWithColumns,
} from "drizzle-orm/pg-core";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";

import { DbError } from "../../errors/DbError.ts";
import { DbTimeoutError } from "../../errors/DbTimeoutError.ts";
import { assertAttrsReachable } from "../../helpers/pgAttr.ts";
import type { DbTransaction } from "../../interfaces/DbTransaction.ts";
import type { TransactionOptions } from "../../interfaces/TransactionOptions.ts";
import type { EntityPrimitive } from "../../primitives/$entity.ts";
import type { SequencePrimitive } from "../../primitives/$sequence.ts";
import { databaseEnvSchema } from "../../schemas/databaseEnvSchema.ts";
import type { ModelBuilder } from "../../services/ModelBuilder.ts";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";

/**
 * A raw statement: a `sql` template, or a plain string run as it is.
 */
export type SQLLike = SQL | string;

export abstract class DatabaseProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();
  /**
   * @internal Driver plumbing, outside semver.
   */
  protected abstract readonly builder: ModelBuilder;
  /**
   * @internal Driver plumbing, outside semver.
   */
  protected readonly kit = $inject(DrizzleKitProvider);

  /**
   * The drizzle database this provider drives.
   *
   * @internal Outside semver: reach it through `Drizzle.db()` from
   * `alepha/orm/drizzle`.
   */
  public abstract readonly db: PgAsyncDatabase<any>;

  /**
   * Open the driver's connection, for drivers that have an explicit one.
   *
   * Optional: sqlite-family drivers open lazily on first use and declare
   * neither. Callers use `provider.connect?.()`  -  the CLI used to reach for
   * `(provider as any).connect()` because the base class said nothing.
   */
  public connect?(): Promise<void>;

  /**
   * Close the driver's connection. Optional for the same reason as
   * {@link connect}.
   */
  public close?(): Promise<void>;
  public abstract readonly dialect: "postgresql" | "sqlite";
  public abstract readonly url: string;

  /**
   * How many values one statement may bind. Every `inArray` value and every
   * column of every row of a multi-row INSERT is one; past the ceiling the
   * driver refuses the statement outright, on data volume rather than on
   * anything the code did (`DbTooManyParametersError`).
   *
   * SQLite's `SQLITE_MAX_VARIABLE_NUMBER` defaults to 32766 since 3.32,
   * PostgreSQL takes 65535, and Cloudflare D1 stops at 100. `createMany`
   * sizes its batches from this, so a driver with a low ceiling gets short
   * statements instead of an error on the row that crosses it.
   */
  public readonly maxBoundParameters: number = 32766;

  public readonly enums = new Map<string, unknown>();
  public readonly tables = new Map<string, unknown>();
  public readonly sequences = new Map<string, unknown>();
  public readonly schemas = new Map<string, unknown>();

  protected readonly entityPrimitives: EntityPrimitive[] = [];
  protected readonly sequencePrimitives: SequencePrimitive[] = [];

  public get name() {
    return "default";
  }

  public get driver(): string {
    return this.dialect;
  }

  /**
   * Whether this driver supports SQL-level transactions (BEGIN/COMMIT/ROLLBACK).
   *
   * Drivers that do not (e.g. PGlite, Cloudflare D1) should override to `false`.
   *
   * Also `false` in a test run with `DATABASE_TRANSACTIONS=false`, so a spec
   * on SQLite behaves like D1: `$transactional()` runs its body in place and
   * nothing rolls back. Ignored outside `NODE_ENV=test`.
   */
  public get supportsTransactions(): boolean {
    return !this.transactionsSwitchedOff;
  }

  /**
   * Whether a test switched transactions off (`DATABASE_TRANSACTIONS=false`).
   */
  protected get transactionsSwitchedOff(): boolean {
    if (!this.alepha.isTest()) {
      return false;
    }
    const { DATABASE_TRANSACTIONS } = this.alepha.parseEnv(databaseEnvSchema);
    return DATABASE_TRANSACTIONS === false;
  }

  /**
   * Raw database connection handle (e.g. DatabaseSync, bun:sqlite Database).
   * Override in providers that expose native connections for introspection.
   */
  public get nativeConnection(): unknown {
    return undefined;
  }

  public get schema() {
    return "public";
  }

  /**
   * Migration tracking table name, scoped by schema.
   *
   * Returns `migrations_{schema}` so that multiple schemas sharing the same
   * database each get their own migration history (e.g. `migrations_lore`,
   * `migrations_public`).
   */
  public get migrationsTable(): string {
    return `migrations_${this.schema}`;
  }

  /**
   * Log a database query with structured metadata for devtools inspection.
   */
  protected logQuery(
    sql: string,
    params: unknown[],
    duration: number,
    rowCount: number,
    error?: string,
  ): void {
    const operation = this.parseOperation(sql);
    const data = {
      type: "db:query",
      sql,
      params,
      operation,
      duration: Math.round(duration * 100) / 100,
      rowCount,
      success: !error,
      error,
    };

    if (error) {
      this.log.warn(`Query failed (${operation})`, data);
    } else {
      this.log.debug(
        `Query OK (${operation}, ${Math.round(duration)}ms)`,
        data,
      );
    }
  }

  protected parseOperation(sql: string): string {
    const trimmed = sql.trimStart().toUpperCase();
    if (trimmed.startsWith("SELECT")) return "SELECT";
    if (trimmed.startsWith("INSERT")) return "INSERT";
    if (trimmed.startsWith("UPDATE")) return "UPDATE";
    if (trimmed.startsWith("DELETE")) return "DELETE";
    if (trimmed.startsWith("CREATE")) return "CREATE";
    if (trimmed.startsWith("ALTER")) return "ALTER";
    if (trimmed.startsWith("DROP")) return "DROP";
    return "OTHER";
  }

  /**
   * The drizzle table built for an entity.
   *
   * @internal Outside semver: reach it through `Drizzle.table()` from
   * `alepha/orm/drizzle`.
   */
  public table<T extends ZObject>(
    entity: EntityPrimitive<T>,
  ): PgTableWithColumns<any> {
    const table = this.tables.get(entity.name);
    if (!table) {
      throw new AlephaError(`Table '${entity.name}' is not registered`);
    }

    const hasAlias = (entity as any).$alias;

    if (hasAlias) {
      // `alias()` rewrites every column's `tableName`, so the aliased table is
      // deliberately a different type from the original. Now that columns
      // carry their value types this no longer overlaps structurally, and the
      // cast has to go through `unknown`. Callers still see the un-aliased
      // type, which is what they query against.
      return alias(table as PgTableWithColumns<any>, hasAlias);
    }

    return table as PgTableWithColumns<any>;
  }

  public registerEntity(entity: EntityPrimitive) {
    assertAttrsReachable(entity.name, entity.schema);
    this.entityPrimitives.push(entity);
    this.builder.buildTable(entity, this);
  }

  public registerSequence(sequence: SequencePrimitive) {
    this.sequencePrimitives.push(sequence);
    this.builder.buildSequence(sequence, this);
  }

  /**
   * Rebuild all models into fresh maps using a different schema.
   *
   * When called with `"public"`, produces schema-free models suitable for
   * migration generation (no schema qualifiers in the SQL output).
   */
  public rebuildModels(targetSchema: string): {
    tables: Map<string, unknown>;
    enums: Map<string, unknown>;
    sequences: Map<string, unknown>;
    schemas: Map<string, unknown>;
  } {
    const result = {
      tables: new Map<string, unknown>(),
      enums: new Map<string, unknown>(),
      sequences: new Map<string, unknown>(),
      schemas: new Map<string, unknown>(),
      schema: targetSchema,
    };

    for (const entity of this.entityPrimitives) {
      this.builder.buildTable(entity, result);
    }
    for (const seq of this.sequencePrimitives) {
      this.builder.buildSequence(seq, result);
    }

    return result;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Cancellation (#E85)
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The context key holding the signal a statement runs under. A driver that
   * can cancel a running statement reads it when it sends one (see
   * {@link cancellable}).
   */
  public static readonly STATEMENT_SIGNAL = "alepha.orm.signal";

  /**
   * The signal of the current unit of work, or `undefined` outside one.
   *
   * The app signal is not one: an owner drains its units on stop, and the
   * reads and writes it does to record their outcome (a job's terminal row)
   * must not be refused because stop began. So is `detachSignal`'s.
   */
  protected unitSignal(): AbortSignal | undefined {
    const ambient = this.alepha.context.signal;
    return ambient === this.alepha.context.appSignal ? undefined : ambient;
  }

  /**
   * Run one repository statement under its signal (owner decision, #E85):
   *
   * - a **read** outside a transaction inherits the unit's signal, composed
   *   with an explicit one;
   * - a **write** outside a transaction honors an explicit signal only:
   *   cutting a write sequence short leaves half-done work nothing undoes;
   * - **inside a transaction** nothing is cut short; an explicit signal that
   *   already fired still refuses the statement.
   *
   * A statement whose signal already fired is refused before it is sent,
   * with the signal's reason. In flight, a driver that can cancel a running
   * statement does (postgres.js; `Bun.sql` only while the query is still
   * queued); the others let it finish.
   */
  public async statement<R>(
    kind: "read" | "write",
    options: {
      signal?: AbortSignal;
      inTransaction: boolean;
      timeout?: DurationLike | false;
    },
    fn: () => Promise<R>,
  ): Promise<R> {
    if (options.inTransaction) {
      options.signal?.throwIfAborted();
      return fn();
    }

    const timeout = this.statementTimeout(kind, options.timeout);
    if (timeout === undefined) {
      return this.signalled(kind, options.signal, fn);
    }

    // `ambient: false`: the deadline's own signal, composed below by the
    // same rule as an explicit one. A write must not inherit the unit's
    // signal through its timeout.
    try {
      return await this.dateTime.deadline(
        (deadline) =>
          this.signalled(
            kind,
            options.signal
              ? AbortSignal.any([options.signal, deadline])
              : deadline,
            fn,
          ),
        timeout,
        { ambient: false },
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new DbTimeoutError(
          `Query timed out after ${error.data.timeout} ms`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * The timeout a statement outside a transaction runs under (#E87): its
   * own, else `DATABASE_TIMEOUT` (5 s on serverless, off elsewhere) unless
   * `DATABASE_TIMEOUT_SCOPE` is `reads` and this is a write. `undefined`
   * for none.
   *
   * What it stops depends on the driver: postgres.js cancels the running
   * statement; a driver that cannot cancel (SQLite, PGlite) refuses a
   * statement whose deadline already passed and lets a started one finish.
   */
  protected statementTimeout(
    kind: "read" | "write",
    own: DurationLike | false | undefined,
  ): DurationLike | undefined {
    if (own !== undefined) {
      return own === false || own === 0 ? undefined : own;
    }
    const { ms, scope } = this.defaultStatementTimeout();
    if (ms <= 0 || (scope === "reads" && kind === "write")) {
      return undefined;
    }
    return ms;
  }

  /**
   * `DATABASE_TIMEOUT` and its scope, read once.
   */
  protected statementTimeoutDefault?: { ms: number; scope: "all" | "reads" };

  /**
   * The default statement timeout: `DATABASE_TIMEOUT`, else 5 s on
   * serverless and off elsewhere. Cloudflare D1 answers 0 here: its own
   * binding wrapper enforces the same default (`D1TimeoutProvider`).
   */
  protected defaultStatementTimeout(): { ms: number; scope: "all" | "reads" } {
    if (!this.statementTimeoutDefault) {
      const env = this.alepha.parseEnv(databaseEnvSchema);
      const configured = env.DATABASE_TIMEOUT;
      this.statementTimeoutDefault = {
        ms:
          configured !== undefined
            ? Number(configured)
            : this.alepha.isServerless()
              ? 5_000
              : 0,
        scope: env.DATABASE_TIMEOUT_SCOPE ?? "all",
      };
    }
    return this.statementTimeoutDefault;
  }

  /**
   * Whether a statement in flight is raced against its signal: rejected with
   * the signal's reason as soon as it aborts, the statement itself left to
   * finish. For a driver that cannot cancel a running statement and must
   * not hold its caller either (Cloudflare D1).
   */
  protected readonly racesStatementSignal: boolean = false;

  /**
   * {@link statement} once its timeout is settled: the statement under the
   * explicit signal, composed with the unit's for a read.
   */
  protected async signalled<R>(
    kind: "read" | "write",
    explicit: AbortSignal | undefined,
    fn: () => Promise<R>,
  ): Promise<R> {
    const unit = kind === "read" ? this.unitSignal() : undefined;
    const signal =
      explicit && unit && explicit !== unit
        ? AbortSignal.any([explicit, unit])
        : (explicit ?? unit);
    if (!signal) {
      return fn();
    }

    signal.throwIfAborted();
    try {
      const run = this.alepha.context.nest(() => {
        this.alepha.context.set(DatabaseProvider.STATEMENT_SIGNAL, signal);
        return fn();
      });
      return await (this.racesStatementSignal
        ? this.raceSignal(run, signal)
        : run);
    } catch (error) {
      // A cancelled statement fails with the driver's own error (Postgres
      // 57014); the caller is told why it stopped instead.
      if (signal.aborted) {
        throw signal.reason;
      }
      throw error;
    }
  }

  /**
   * Settle with `run`, or reject with `signal`'s reason as soon as it aborts.
   * The statement keeps running; its later failure stays observed.
   */
  protected raceSignal<R>(run: Promise<R>, signal: AbortSignal): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      run.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  /**
   * Wrap a postgres.js or `Bun.sql` client so that a statement sent under a
   * statement signal (see {@link statement}) is cancelled when it aborts.
   *
   * The query objects both drivers return run lazily, on their first
   * `then`, and drizzle chains `.values()` on them before awaiting. So the
   * listener is attached without calling `then`, and removed by the first
   * `then` call, which is when the query actually runs and settles.
   *
   * A transaction's statements go through the client `begin()` hands its
   * callback, which is not wrapped: a transaction is never cut short.
   */
  protected cancellable<T extends object>(client: T): T {
    const watch = (query: unknown): unknown => {
      const signal = this.alepha.context.get<AbortSignal>(
        DatabaseProvider.STATEMENT_SIGNAL,
      );
      const pending = query as {
        cancel?: () => unknown;
        then?: (...args: any[]) => unknown;
      } | null;
      if (
        !signal ||
        !pending ||
        typeof pending.cancel !== "function" ||
        typeof pending.then !== "function"
      ) {
        return query;
      }

      const cancel = () => {
        try {
          pending.cancel?.();
        } catch {
          // Already settled.
        }
      };
      if (signal.aborted) {
        cancel();
        return query;
      }

      signal.addEventListener("abort", cancel, { once: true });
      const cleanup = () => signal.removeEventListener("abort", cancel);
      const then = pending.then;
      // oxlint-disable-next-line unicorn/no-thenable -- wraps the driver's own `then` on an object that already is a thenable, to learn when the query ran without running it early
      pending.then = function (
        this: unknown,
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return then.call(
          this,
          (value: unknown) => {
            cleanup();
            return onFulfilled ? onFulfilled(value) : value;
          },
          (reason: unknown) => {
            cleanup();
            if (onRejected) return onRejected(reason);
            throw reason;
          },
        );
      };
      return query;
    };

    return new Proxy(client, {
      apply: (target, thisArg, args) =>
        watch(
          Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args),
        ),
      get: (target, prop) => {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") {
          return value;
        }
        if (prop === "unsafe") {
          return (...args: unknown[]) => watch(value.apply(target, args));
        }
        return value.bind(target);
      },
    });
  }

  /**
   * Run a function inside a database transaction with implicit tx propagation.
   *
   * The transaction object is stored in `alepha.store` so that all Repository
   * operations within `fn` automatically participate in the transaction without
   * explicit `{ tx }` drilling.
   *
   * Nesting joins: inside a `transactional()` block, the inner call runs on
   * the outer transaction (no nested transaction, no savepoint), so a throw
   * in it rolls back the whole block. An inner call whose `options` the
   * outer transaction cannot honour throws instead of joining silently: a
   * different `isolation`, or `access: "read write"` inside a read-only
   * transaction. No options, or the same ones, join.
   *
   * The marker lives in a nested context, never the caller's. Two concurrent
   * calls both pass the check below  -  it reads the marker synchronously, and
   * the write only happens once `db.transaction()` holds a connection  -  so each
   * one opens a transaction of its own. Sharing a single slot between them
   * meant the second write won, and then the first block to finish cleared the
   * slot while the second was still inside its transaction: every query it made
   * from that point ran on a pooled connection with no transaction at all,
   * reading committed rows and not its own writes.
   */
  public async transactional<R>(
    fn: () => Promise<R>,
    options?: TransactionOptions,
    owner?: object,
  ): Promise<R> {
    const existing = this.alepha.get("alepha.orm.tx");
    if (existing) {
      this.assertJoinable(options);
      return fn();
    }

    // Checked before BEGIN only: once begun, a transaction runs to commit or
    // rolls back on its own error, whatever happens to its caller (#E85).
    this.unitSignal()?.throwIfAborted();

    if (!this.supportsTransactions) {
      this.warnWithoutTransactions(owner);
      return fn();
    }

    return this.alepha.context.nest(async () => {
      const afterCommit: Array<() => void | Promise<void>> = [];
      const result = await this.db.transaction(async (tx) => {
        this.alepha.store.set("alepha.orm.tx", tx as unknown as DbTransaction, {
          skipEvents: true,
        });
        this.alepha.store.set("alepha.orm.txOptions", options, {
          skipEvents: true,
        });
        this.alepha.store.set("alepha.orm.afterCommit", afterCommit, {
          skipEvents: true,
        });
        try {
          return await fn();
        } finally {
          this.alepha.store.set("alepha.orm.tx", undefined, {
            skipEvents: true,
          });
          this.alepha.store.set("alepha.orm.txOptions", undefined, {
            skipEvents: true,
          });
          this.alepha.store.set("alepha.orm.afterCommit", undefined, {
            skipEvents: true,
          });
        }
      }, this.toDrizzleTransactionConfig(options));

      await this.drainAfterCommit(afterCommit);
      return result;
    });
  }

  /**
   * Refuse to join the open transaction when it cannot give a nested call
   * what that call asked for.
   */
  protected assertJoinable(options?: TransactionOptions): void {
    if (!options) {
      return;
    }
    const outer = this.alepha.get("alepha.orm.txOptions") ?? {};
    if (options.isolation && options.isolation !== outer.isolation) {
      throw new AlephaError(
        `A nested transaction asked for isolation '${options.isolation}', but it joins the open transaction, which runs at '${outer.isolation ?? "the database default"}'. Set the isolation on the outermost $transactional.`,
      );
    }
    if (options.access === "read write" && outer.access === "read only") {
      throw new AlephaError(
        "A nested transaction asked for 'read write', but it joins the open transaction, which is 'read only'.",
      );
    }
  }

  /**
   * Translate Alepha's transaction options into drizzle's config.
   *
   * @internal
   */
  public toDrizzleTransactionConfig(
    options?: TransactionOptions,
  ): PgTransactionConfig | undefined {
    if (!options?.isolation && !options?.access) {
      return undefined;
    }
    return {
      isolationLevel: options.isolation,
      accessMode: options.access,
    };
  }

  /**
   * The `$transactional()` primitives already warned about running bare.
   */
  protected readonly warnedWithoutTransactions = new WeakSet<object>();

  /**
   * Say once per `$transactional()` primitive that it protects nothing here.
   *
   * Quiet under the test switch (`DATABASE_TRANSACTIONS=false`), whose whole
   * point is to run bare on purpose.
   */
  protected warnWithoutTransactions(owner?: object): void {
    if (
      !owner ||
      this.transactionsSwitchedOff ||
      this.warnedWithoutTransactions.has(owner)
    ) {
      return;
    }
    this.warnedWithoutTransactions.add(owner);
    this.log.warn(
      `$transactional() runs without a transaction: the ${this.driver} driver has none, so a failure rolls nothing back`,
    );
  }

  /**
   * Run `callback` once the surrounding transaction has committed.
   *
   * Inside a `transactional()` block the callback is queued on the OUTERMOST
   * transaction  -  nested blocks join it, so a callback registered three layers
   * deep still waits for the single real COMMIT. Queued callbacks run in
   * registration order, awaited one by one, and are discarded when the
   * transaction rolls back. Outside any transaction (including drivers with
   * `supportsTransactions === false`) the callback runs, awaited, in place.
   *
   * This is the safe way to emit a domain event from transactional code:
   * emitting inside the transaction hands subscribers uncommitted rows and
   * keeps row locks held for as long as they run  -  a subscriber that talks to
   * an SMTP server extends the transaction by the length of that call.
   *
   * A callback that throws propagates to the `transactional()` caller, but by
   * then the transaction has committed  -  it cannot unwind the work.
   */
  public async afterCommit(
    callback: () => void | Promise<void>,
  ): Promise<void> {
    const queue = this.alepha.get("alepha.orm.afterCommit");
    if (queue) {
      queue.push(callback);
      return;
    }
    await callback();
  }

  /**
   * Run queued after-commit callbacks, in registration order.
   *
   * Called by the outermost transaction owner once its COMMIT has returned.
   * By then the store keys are cleared, so a callback that itself calls
   * {@link afterCommit} runs the new callback immediately instead of
   * appending to the queue being drained.
   */
  protected async drainAfterCommit(
    callbacks: Array<() => void | Promise<void>>,
  ): Promise<void> {
    for (const callback of callbacks) {
      await callback();
    }
  }

  /**
   * Whether this driver runs `db.transaction()` through drizzle's synchronous
   * SQLite session. Sync sessions COMMIT as soon as the callback returns, so
   * an async callback would commit before its awaited work finishes; such
   * drivers must route transactions through the awaited `transactional()`
   * implementation instead.
   */
  public get usesSyncTransactions(): boolean {
    return false;
  }

  /**
   * Chain of pending native transactions  -  sync SQLite drivers share a single
   * connection, so BEGIN blocks must be serialized.
   */
  protected txMutex: Promise<unknown> = Promise.resolve();

  /**
   * How many transactions (and statements deferred behind them) are queued or
   * running on {@link txMutex}. Zero is the common case, and then a statement
   * runs at once, synchronously, exactly as it always did.
   */
  protected pendingExclusive = 0;

  /**
   * Hold every statement of a sync SQLite session behind an open transaction
   * it is not part of (#Q2516).
   *
   * The connection is shared, and a transaction on it is connection-scoped:
   * a plain write from another request, run while transaction A awaits
   * between two of its statements, ran INSIDE A's `BEGIN`. When A rolled
   * back, that acknowledged write vanished, and the request had read A's
   * uncommitted rows. Only BEGIN blocks were serialized.
   *
   * Wrapped at the prepared query, the one path the repository, the
   * relational query builder and `execute` all share. A statement runs at once
   * when nothing is pending or when its caller is inside the running
   * transaction (the tx marker is in its context); otherwise it is queued on
   * the same chain as the transactions and returns a promise, which every
   * caller already awaits.
   */
  protected gateSyncSession(session: {
    prepareQuery: (...args: any[]) => any;
  }): void {
    const prepare = session.prepareQuery.bind(session);
    session.prepareQuery = (...args: any[]) => {
      const prepared = prepare(...args);
      for (const method of ["run", "all", "get", "values"] as const) {
        const original = prepared[method];
        if (typeof original !== "function") continue;
        prepared[method] = (...params: unknown[]) =>
          this.deferBehindTransaction(() => original.apply(prepared, params));
      }
      return prepared;
    };
  }

  /**
   * Run `exec` now when no transaction stands in its way, or queue it behind
   * the pending ones.
   */
  protected deferBehindTransaction<R>(exec: () => R): R | Promise<R> {
    if (this.pendingExclusive === 0 || this.alepha.get("alepha.orm.tx")) {
      return exec();
    }
    this.pendingExclusive += 1;
    const result = this.txMutex.then(() => exec());
    this.txMutex = result.then(
      () => undefined,
      () => undefined,
    );
    void this.txMutex.then(() => {
      this.pendingExclusive -= 1;
    });
    return result;
  }

  /**
   * Awaited BEGIN/COMMIT/ROLLBACK on a single shared native connection,
   * serialized so two concurrent contexts can't collide ("cannot start a
   * transaction within a transaction") or end each other's half-finished
   * transaction.
   */
  protected runExclusiveNativeTransaction<R>(
    exec: (sql: string) => void,
    fn: () => Promise<R>,
    options?: TransactionOptions,
  ): Promise<R> {
    const afterCommit: Array<() => void | Promise<void>> = [];
    // Always a layer of its own, like the async `transactional()`: the
    // marker is private to this transaction and dies with it. With no async
    // context at all it used to land in the app-wide store, where every
    // concurrent caller read it and joined this transaction without a BEGIN
    // of its own (#Q2516). Inside a request, the layer sits between an action
    // and its guards, which `$secure` reads through with the `"fork"` scope
    // (#Q2538), so `$transactional()` ahead of `$owns` still sees the body.
    const body = async (): Promise<R> => {
      // Set the tx marker to the drizzle db itself  -  SQLite transactions are
      // connection-scoped, so all operations on this connection participate.
      this.alepha.store.set("alepha.orm.tx", this.db as any, {
        skipEvents: true,
      });
      this.alepha.store.set("alepha.orm.txOptions", options, {
        skipEvents: true,
      });
      this.alepha.store.set("alepha.orm.afterCommit", afterCommit, {
        skipEvents: true,
      });
      exec("BEGIN");
      try {
        const result = await fn();
        exec("COMMIT");
        return result;
      } catch (error) {
        exec("ROLLBACK");
        throw error;
      } finally {
        this.alepha.store.set("alepha.orm.tx", undefined, {
          skipEvents: true,
        });
        this.alepha.store.set("alepha.orm.txOptions", undefined, {
          skipEvents: true,
        });
        this.alepha.store.set("alepha.orm.afterCommit", undefined, {
          skipEvents: true,
        });
      }
    };
    const run = (): Promise<R> => this.alepha.context.nest(body);

    this.pendingExclusive += 1;
    const result = this.txMutex.then(run, run);
    this.txMutex = result.then(
      () => undefined,
      () => undefined,
    );
    void this.txMutex.then(() => {
      this.pendingExclusive -= 1;
    });
    // Drained outside the mutex chain: a callback that opens a transaction of
    // its own must be able to take the mutex, and the next queued transaction
    // must not wait for callbacks that no longer hold the connection.
    return result.then(async (value) => {
      await this.drainAfterCommit(afterCommit);
      return value;
    });
  }

  /**
   * The handle a raw statement runs on: the open transaction when there is
   * one, the connection (or pool) otherwise. The same choice the Repository
   * makes for its own methods, so {@link execute} and {@link run} take part in
   * a `transactional()` block.
   *
   * @internal Driver plumbing, outside semver.
   */
  protected get executor(): PgAsyncDatabase<any> {
    const tx = this.alepha.get("alepha.orm.tx") as unknown as
      | PgAsyncTransaction<any>
      | undefined;
    return tx ?? this.db;
  }

  /**
   * Run a raw statement and return its rows.
   *
   * Inside a `transactional()` block it runs on that transaction, on every
   * driver: on SQLite the connection is shared anyway, and on Postgres the
   * statement goes to the transaction's connection, not the pool.
   */
  public abstract execute(
    statement: SQLLike,
  ): Promise<Record<string, unknown>[]>;

  public async run<T extends ZObject>(
    statement: SQLLike,
    schema: T,
  ): Promise<Array<Infer<T>>> {
    const result = await this.execute(statement);

    if (result == null) {
      return [];
    }

    if (!Array.isArray(result)) {
      const error = new DbError(
        "Unexpected query result format, expected array of rows",
      );
      this.log.error("Unexpected query result format", { result, error });
      throw error;
    }

    return result.map((row) => this.alepha.codec.decode(schema, row));
  }

  /**
   * Get migrations folder path - can be overridden
   */
  protected getMigrationsFolder(): string {
    return `migrations/${this.name}`;
  }

  /**
   * Migration orchestration.
   *
   * - Production: file-based migrations from the migrations folder
   * - Dev / Test: push-based sync (introspects actual DB, no snapshots)
   * - Serverless: skipped (migrations should be applied during deployment)
   */
  public async migrate(): Promise<void> {
    if (this.alepha.isServerless()) {
      return;
    }

    if (this.alepha.isProduction()) {
      const migrationsFolder = this.getMigrationsFolder();
      const exists = await stat(migrationsFolder).catch(() => false);

      if (!exists) {
        // Production is the one environment with no push-sync fallback  -  the
        // `synchronize()` call below lives in the dev/test branch. So an
        // absent migrations folder does not mean "push the schema for me"
        // here, it means "create nothing", and an app that declares entities
        // boots green with no tables and throws `DbTableNotFoundError` on its
        // first query. This used to be a single `warn` and a successful boot,
        // which put the only notice of a completely broken deploy in a
        // startup log, at the moment nobody is reading one.
        //
        // Narrow on purpose. An app that mounts the ORM and declares nothing
        // has no schema to create and still boots. And `DATABASE_SYNC=false`
        // already means "I manage the schema myself"  -  someone applying DDL
        // out of band has stated intent, which is exactly what an absent
        // folder cannot do on its own.
        const { DATABASE_SYNC } = this.alepha.parseEnv(databaseEnvSchema);
        const declaresSchema =
          this.entityPrimitives.length > 0 ||
          this.sequencePrimitives.length > 0;

        if (declaresSchema && DATABASE_SYNC !== false) {
          throw new AlephaError(
            `No migrations found in '${migrationsFolder}', but this app declares ${this.entityPrimitives.length} entit${this.entityPrimitives.length === 1 ? "y" : "ies"}. Production does not push the schema, so the tables would never be created and the first query would fail. Run 'alepha db migrations create' and redeploy, or set DATABASE_SYNC=false if the schema is managed outside the app.`,
          );
        }

        this.log.warn("Migration SKIPPED - no migrations found");
        return;
      }

      // `drizzle-orm@1`'s migrator hard-throws a bare `Error` the instant it
      // finds `<folder>/meta/_journal.json`  -  the bookkeeping file every
      // pre-v1 drizzle-kit project has  -  naming `drizzle-kit up`, a command
      // Alepha users never run directly. The three apps in this repo were
      // baselined onto v1 as part of this upgrade, so that dead end is
      // invisible here, but it is a real backward-incompatibility for every
      // downstream consumer of `alepha` that has not yet baselined. Catch it
      // before it ever reaches drizzle's migrator and point at the actual
      // remedy instead of leaking drizzle's unreachable-for-us instruction.
      const legacyJournalExists = await stat(
        `${migrationsFolder}/meta/_journal.json`,
      )
        .then(() => true)
        .catch(() => false);

      if (legacyJournalExists) {
        throw new AlephaError(
          `'${migrationsFolder}' still uses drizzle-kit's pre-v1 migration layout ('meta/_journal.json'). Run 'alepha db baseline create' to collapse it into a single v1 migration, then 'alepha db baseline mark' (Cloudflare D1: 'alepha infra db baseline mark') to record it as applied without re-executing it.`,
        );
      }

      // For schema-free migrations, ensure the target schema exists
      // before running migration files. The schema is applied via
      // search_path set at the provider's connection level.
      if (this.dialect === "postgresql" && this.schema !== "public") {
        this.log.debug(`Ensuring schema '${this.schema}' exists ...`);
        await this.execute(
          sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw(this.schema)}`,
        );
      }

      this.log.debug(`Migrate from '${migrationsFolder}' directory ...`);
      await this.executeMigrations(migrationsFolder);
      this.log.info("Migration OK");
    } else {
      const { DATABASE_SYNC } = this.alepha.parseEnv(databaseEnvSchema);
      if (DATABASE_SYNC === false) {
        this.log.info(
          "Database synchronization disabled (DATABASE_SYNC=false)",
        );
        return;
      }

      try {
        await this.kit.synchronize(this);
      } catch (error) {
        throw new DbError(
          `Failed to synchronize ${this.dialect} database schema`,
          { cause: error },
        );
      }

      await this.stampBaselineAfterSync();
    }
  }

  /**
   * After a development push, record a lone baseline migration as applied.
   *
   * The push creates the tables and leaves the migrations journal empty, so
   * the same database read by a production boot looks like one where nothing
   * has ever been applied  -  and production replays the baseline onto tables
   * that already exist. A fresh scaffold hits this on its fourth command:
   * `init --preset saas`, `dev`, `build`, `node dist/index.js`.
   *
   * Deliberately narrow. Drizzle's `init: true` records without executing, and
   * refuses when the journal already has rows or when more than one local
   * migration exists  -  which is exactly the state where "the push and the
   * migration files describe the same schema" stops being a safe assumption.
   * Both refusals are the normal steady state here (every boot after the
   * first, and every project past its first migration), so they are logged at
   * debug and nothing more.
   *
   * Best-effort by construction: a driver with no `runMigrator` throws, and a
   * failure to stamp must never take down `alepha dev`. Production correctness
   * does not rest on this  -  {@link NodeSqliteProvider} refusing to share the
   * development database file is what closes that door.
   */
  protected async stampBaselineAfterSync(): Promise<void> {
    const migrationsFolder = this.getMigrationsFolder();

    const exists = await stat(migrationsFolder).catch(() => false);
    if (!exists) {
      return;
    }

    try {
      const result = await this.runMigrator(migrationsFolder, { init: true });

      if (result?.exitCode) {
        this.log.debug(
          `Baseline not stamped after sync (${result.exitCode})  -  the journal is already populated, or more than one migration exists`,
        );
        return;
      }

      this.log.debug(
        `Baseline recorded as applied for '${this.name}' after schema push`,
      );
    } catch (error) {
      this.log.debug("Could not stamp the baseline after schema push", error);
    }
  }

  /**
   * Provider-specific migration execution.
   *
   * Default implementation delegates to {@link runMigrator}, the
   * driver-dispatch method shared with {@link markBaselineApplied}. Drivers
   * whose migration flow doesn't fit that shape  -  Cloudflare D1 and
   * Cloudflare Hyperdrive, both fully self-contained, error-wrapped flows
   * with no baseline-mark support (yet)  -  override this method directly
   * instead and never implement `runMigrator`.
   */
  protected async executeMigrations(migrationsFolder: string): Promise<void> {
    await this.runMigrator(migrationsFolder);
  }

  /**
   * Driver-specific dispatch to drizzle's `migrate()`, shared between the
   * normal migration path (via the default {@link executeMigrations}) and
   * {@link markBaselineApplied}. Implementations must pass
   * `{ migrationsFolder, ...options }` through to their driver's own
   * drizzle migrator import and return its result unchanged  -  that result
   * is how drizzle v1 reports the `init: true` guardrails back to the
   * caller.
   *
   * The base implementation throws; every runtime-migrator dialect
   * (Postgres, local SQLite, PGlite, Bun) overrides it. Cloudflare D1 and
   * Cloudflare Hyperdrive do not  -  they fully override
   * {@link executeMigrations} instead, so this default is only reachable
   * through {@link markBaselineApplied} for those two, which is why the
   * error names "baseline mark" rather than "migrations": D1 and Hyperdrive
   * both migrate fine through their own flows, they just don't support
   * baseline-mark's driver-dispatch shape yet.
   *
   * D1 now has a baseline-mark path  -  `D1MigrationsService.baseline`,
   * reachable via `alepha infra db baseline mark`  -  but it does not go
   * through this method at all (it drives the `d1_migrations` bookkeeping
   * table directly over the D1 API, with no drizzle migrator involved). `alepha db baseline mark`
   * (the core command that calls `markBaselineApplied`) redirects D1
   * providers to that command before ever reaching here; this default throw
   * still guards a direct `provider.markBaselineApplied()` call and remains
   * accurate for Hyperdrive, which has no baseline-mark path anywhere yet.
   */
  protected async runMigrator(
    migrationsFolder: string,
    options?: { init?: boolean },
  ): Promise<{ exitCode?: string } | void> {
    if (this.driver === "d1") {
      throw new AlephaError(
        "D1 does not support baseline-mark through this method  -  use 'alepha infra db baseline mark', which drives wrangler's bookkeeping table directly.",
      );
    }
    throw new AlephaError(
      `'baseline mark' does not yet support the '${this.driver}' driver`,
    );
  }

  /**
   * Whether this process was started to apply migrations and nothing else.
   *
   * The same condition `$mode({ env: "MIGRATE" })` activates on. Read here so a
   * driver can tell "a deployed server is booting" from "someone ran
   * `alepha db migrations apply`"  -  the CLI boots the app with
   * `NODE_ENV=production` for that command so migrations run through the
   * file-based path, which makes `isProduction()` alone unable to distinguish
   * the two.
   */
  protected isMigrationRun(): boolean {
    return (
      this.alepha.isEnvEnabled("MIGRATE") || this.alepha.env.MODE === "MIGRATE"
    );
  }

  /**
   * Record the single baseline migration as applied WITHOUT executing it.
   *
   * Drizzle v1's migrator ships this natively: `init: true` inserts the
   * bookkeeping row and returns without running any SQL. It refuses when
   * the database already has migration rows (`databaseMigrations`) or when
   * more than one local migration exists (`localMigrations`), which is
   * exactly the invariant a baseline needs  -  adopting an existing database
   * into a fresh migration history must start from a clean bookkeeping
   * table and a single collapsed baseline file.
   */
  public async markBaselineApplied(migrationsFolder: string): Promise<void> {
    const result = await this.runMigrator(migrationsFolder, { init: true });

    if (result?.exitCode === "databaseMigrations") {
      throw new AlephaError(
        `Database already has migration rows. A baseline can only be recorded on a database with no migration history. Resetting an existing history is not yet supported for the '${this.driver}' driver  -  clear the migrations bookkeeping table manually first. (Cloudflare D1 supports this via 'alepha infra db baseline mark --reset'.)`,
      );
    }

    if (result?.exitCode === "localMigrations") {
      throw new AlephaError(
        "More than one local migration found. Run 'alepha db baseline create' first so exactly one baseline migration exists.",
      );
    }

    this.log.info(`Baseline recorded as applied for '${this.name}'`);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * For testing purposes, generate a unique schema name.
   *
   * Format: `test_alepha_{epoch_seconds}_{random8}`
   * Example: `test_alepha_1739871618_k3m9x2p1`
   */
  protected generateTestSchemaName(): string {
    const epoch = Math.floor(this.dateTime.nowMillis() / 1000);
    const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0");

    return `test_alepha_${epoch}_${random}`;
  }
}
