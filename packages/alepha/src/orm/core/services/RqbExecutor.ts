import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { defineRelations } from "drizzle-orm";
import type { EntityPrimitive } from "../primitives/$entity.ts";
import type {
  EntitySchema,
  RelationMapFor,
  RelationsPrimitive,
  ResolvedRelation,
} from "../primitives/$relations.ts";
import type { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";
import { RepositoryProvider } from "../providers/RepositoryProvider.ts";
import { QueryManager } from "./QueryManager.ts";

/**
 * Runs relational reads through Drizzle's own relational query builder.
 *
 * The alternative — issuing one query per relation and stitching in memory —
 * works, but Drizzle already solves this per dialect and solves it better:
 * Postgres gets lateral joins with `json_agg`, SQLite gets correlated
 * subqueries with `json_object` / `json_group_array`, and the D1 driver alone
 * passes `forbidJsonb` because D1's SQLite has no `jsonb`. Those are decisions
 * nobody would rediscover by hand, and the whole tree arrives in one round
 * trip.
 *
 * Three things make the swap a translation rather than a rewrite:
 *
 * - Drizzle's filter syntax has a `RAW` escape hatch that takes a Drizzle
 *   `SQL` object, so Alepha's existing where-to-SQL conversion is reused
 *   whole, with all of its operators.
 * - The predicates that make a read safe — soft delete, tenancy — are asked
 *   of the repository itself through {@link Repository.readWhere}, so they are
 *   the same predicates a direct read would apply, down to the strict-tenancy
 *   refusal. They are pushed onto every level of the tree, including relations
 *   the caller included with a bare `true`.
 * - Rows come back decoded by the table but not validated, so each level is
 *   handed to its own repository afterwards. Relation fields belong to another
 *   entity's schema, so they are carried across that step rather than run
 *   through it.
 *
 * `db.query` is built in a database's constructor, and Alepha's connection is
 * opened long before an application declares any relations. So this never
 * reconfigures that connection: it builds a second database over the same
 * *session*, which is where the connection actually lives — the session of the
 * open transaction when there is one, so a relational read inside
 * `transactional()` sees the transaction's own uncommitted writes.
 */
export class RqbExecutor {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly repositories = $inject(RepositoryProvider);
  protected readonly queryManager = $inject(QueryManager);

  /**
   * One relational database per declaration *per session* — the session
   * changes when a transaction opens, and a database built over the wrong one
   * would read around it.
   */
  protected readonly built = new WeakMap<object, WeakMap<object, unknown>>();

  /**
   * Read a tree of rows in one statement.
   */
  public async findMany(options: {
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>;
    entityKey: string;
    provider: DatabaseProvider;
    query: RqbQuery;
  }): Promise<Array<Record<string, any>>> {
    const { relations, entityKey, provider, query } = options;

    const db = this.databaseFor(relations, provider) as any;
    const builder = db.query[entityKey];

    if (!builder) {
      throw new AlephaError(
        `'${entityKey}' has no relational query builder. Is it in the schema passed to $relations()?`,
      );
    }

    for (const table of this.tablesRead(relations, entityKey, query)) {
      await this.alepha.events.emit("repository:read:before", {
        tableName: table,
        query,
      });
    }

    const rows = (await builder.findMany(
      this.toRqbQuery(relations, entityKey, provider, query),
    )) as Array<Record<string, any>>;

    const decoded = this.decode(rows, relations, entityKey, query);

    await this.alepha.events.emit("repository:read:after", {
      tableName: this.repositories.getRepository(
        relations.schema[entityKey] as EntityPrimitive,
      ).tableName,
      query,
      entities: decoded,
    });

    return decoded;
  }

  /**
   * The statement a read would issue, without running it.
   */
  public toSQL(options: {
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>;
    entityKey: string;
    provider: DatabaseProvider;
    query: RqbQuery;
  }): { sql: string; params: Array<unknown> } {
    const { relations, entityKey, provider, query } = options;
    const db = this.databaseFor(relations, provider) as any;

    return db.query[entityKey]
      .findMany(this.toRqbQuery(relations, entityKey, provider, query))
      .toSQL();
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Translate an Alepha query into Drizzle's relational vocabulary.
   *
   * `where` is handed over as `RAW`, which is what keeps this a translation
   * rather than a reimplementation of every filter operator.
   */
  protected toRqbQuery(
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>,
    entityKey: string,
    provider: DatabaseProvider,
    query: RqbQuery,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    const where = this.toRawFilter(relations, entityKey, provider, query.where);
    if (where) out.where = where;

    if (query.select) out.columns = this.toColumns(query.select);
    if (query.orderBy) out.orderBy = this.toOrderBy(query.orderBy);
    if (query.limit !== undefined) out.limit = query.limit;
    if (query.offset !== undefined) out.offset = query.offset;

    if (query.include && Object.keys(query.include).length > 0) {
      out.with = this.toWith(relations, entityKey, provider, query.include);
    }

    return out;
  }

  protected toWith(
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>,
    entityKey: string,
    provider: DatabaseProvider,
    include: Record<string, any>,
  ): Record<string, unknown> {
    const declared = this.declared(relations, entityKey);
    const out: Record<string, unknown> = {};

    for (const [name, arg] of Object.entries(include)) {
      if (arg === undefined || arg === false) continue;

      const relation = declared[name];
      if (!relation) {
        throw new AlephaError(
          `Unknown relation '${name}' on '${entityKey}'. Declared: ${
            Object.keys(declared).join(", ") || "(none)"
          }`,
        );
      }

      // `true` still goes through the full translation rather than short-
      // circuiting: that is where the target's soft-delete and tenancy
      // predicates are attached, and a relation included with a bare `true` is
      // exactly the call site that would otherwise leak deleted rows.
      out[name] = this.toRqbQuery(
        relations,
        relation.target,
        provider,
        arg === true ? {} : arg,
      );
    }

    return out;
  }

  /**
   * Alepha's where becomes a Drizzle `SQL` object handed over as `RAW`.
   *
   * The predicate is taken from the target's own repository, so soft delete
   * and tenancy cross into the relational statement as the same expressions a
   * direct read would use — and a strict tenant-scoped entity read with no
   * resolved tenant throws here, rather than quietly returning every tenant's
   * rows.
   */
  protected toRawFilter(
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>,
    entityKey: string,
    provider: DatabaseProvider,
    where: unknown,
  ): Record<string, unknown> | undefined {
    const entity = relations.schema[entityKey];
    if (!entity) return undefined;

    const repository = this.repositories.getRepository(
      entity as EntityPrimitive,
    );
    const scoped = repository.readWhere(where);

    const build = (table: any) =>
      this.queryManager.toSQL(scoped as never, {
        schema: entity.schema,
        col: (name: string) => table[name],
        dialect: provider.dialect as never,
      });

    // Built against the real table first, only to find out whether there is a
    // predicate at all — an empty one has to be left off rather than passed as
    // an empty `RAW`.
    if (!build(provider.table(entity as EntityPrimitive))) return undefined;

    // ...then handed over as a callback, because every level of a relational
    // statement reads from an *alias* (`d0`, `d1`, …). A predicate compiled
    // against the real table names refers to tables the statement never joins.
    return { RAW: (table: any) => build(table) };
  }

  protected toColumns(select: ReadonlyArray<string>): Record<string, true> {
    return Object.fromEntries(select.map((column) => [column, true]));
  }

  /**
   * Alepha's orderBy shapes become Drizzle's `{ column: "asc" }` map.
   */
  protected toOrderBy(orderBy: unknown): Record<string, "asc" | "desc"> {
    const clauses = this.queryManager.normalizeOrderBy(orderBy as never);
    return Object.fromEntries(
      clauses.map((clause) => [clause.column, clause.direction ?? "asc"]),
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Validate and decode every level of the tree against its own schema.
   *
   * The relational query builder decodes columns using the table definition
   * but never sees the entity schema, so this is where a value that drifted
   * from its declared type is caught — the same guarantee a plain read gives,
   * restored one level at a time.
   */
  protected decode(
    rows: Array<Record<string, any>>,
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>,
    entityKey: string,
    query: RqbQuery,
  ): Array<Record<string, any>> {
    const repository = this.repositories.getRepository(
      relations.schema[entityKey] as EntityPrimitive,
    );
    const declared = this.declared(relations, entityKey);

    const include = query.include ?? {};
    const names = Object.keys(include).filter(
      (name) => include[name] !== undefined && include[name] !== false,
    );

    return rows.map((row) => {
      const cleaned = repository.cleanRow(row, {
        columns: query.select,
        keep: names,
      });

      for (const name of names) {
        const relation = declared[name];
        const nested = include[name] === true ? {} : include[name];
        const value = cleaned[name];

        if (value == null) {
          // A missing to-one is absent, not null — matching what an entity
          // schema says an optional field looks like.
          cleaned[name] = relation.kind === "many" ? [] : undefined;
          continue;
        }

        cleaned[name] = Array.isArray(value)
          ? this.decode(value, relations, relation.target, nested)
          : this.decode([value], relations, relation.target, nested)[0];
      }

      return cleaned;
    });
  }

  /**
   * Every table this query reads, root first.
   */
  protected tablesRead(
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>,
    entityKey: string,
    query: RqbQuery,
  ): Array<string> {
    const repository = this.repositories.getRepository(
      relations.schema[entityKey] as EntityPrimitive,
    );
    const out = [repository.tableName];

    const declared = this.declared(relations, entityKey);
    for (const [name, arg] of Object.entries(query.include ?? {})) {
      if (arg === undefined || arg === false) continue;
      const relation = declared[name];
      if (!relation) continue;
      out.push(
        ...this.tablesRead(
          relations,
          relation.target,
          arg === true ? {} : (arg as RqbQuery),
        ),
      );
    }

    return [...new Set(out)];
  }

  protected declared(
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>,
    entityKey: string,
  ): Record<string, ResolvedRelation> {
    return ((relations.map as any)[entityKey] ?? {}) as Record<
      string,
      ResolvedRelation
    >;
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected databaseFor(
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>,
    provider: DatabaseProvider,
  ): unknown {
    const owner = this.sessionOwner(provider);

    let perSession = this.built.get(relations);
    if (!perSession) {
      perSession = new WeakMap();
      this.built.set(relations, perSession);
    }

    const cached = perSession.get(owner);
    if (cached) return cached;

    const tables: Record<string, unknown> = {};
    for (const [key, entity] of Object.entries(relations.schema)) {
      tables[key] = provider.table(entity as EntityPrimitive);
    }

    // Cast through `any`: the declaration is built from a runtime map, so the
    // static shape `defineRelations` wants to infer is not available here.
    // Callers get their types from `$relations`, not from this.
    const drizzleRelations = (defineRelations as any)(tables, (r: any) =>
      this.toDefineRelations(relations, r),
    );

    const db = this.construct(provider, owner, drizzleRelations);
    perSession.set(owner, db);
    return db;
  }

  /**
   * Whatever currently owns the live session: the open transaction, or the
   * connection itself.
   */
  protected sessionOwner(provider: DatabaseProvider): any {
    return this.alepha.get("alepha.orm.tx") ?? (provider.db as any);
  }

  /** Translate the declaration into Drizzle's own relation shape. */
  protected toDefineRelations(
    relations: RelationsPrimitive<EntitySchema, RelationMapFor<EntitySchema>>,
    r: any,
  ): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};

    for (const [entityKey, declared] of Object.entries(relations.map)) {
      if (!declared) continue;

      const entry: Record<string, unknown> = {};

      for (const [name, relation] of Object.entries(
        declared as Record<string, ResolvedRelation>,
      )) {
        const factory = r[relation.kind][relation.target];

        const from = relation.through
          ? r[entityKey][relation.from].through(
              r[relation.through.entity][relation.through.fromColumn],
            )
          : r[entityKey][relation.from];

        const to = relation.through
          ? r[relation.target][relation.to].through(
              r[relation.through.entity][relation.through.toColumn],
            )
          : r[relation.target][relation.to];

        entry[name] = factory({ from, to });
      }

      out[entityKey] = entry;
    }

    return out;
  }

  /**
   * Rebuild the provider's database class with relations attached.
   *
   * The class comes off the connection rather than an import, so each dialect
   * gets its own — and so does whatever `forbidJsonb` / `parseRqbJson` flag
   * that driver was constructed with, which is exactly the D1-specific
   * decision worth not losing. The *session* comes off `owner` instead, which
   * is the transaction when one is open; a transaction subclasses the database
   * with a different constructor signature, so only its session is borrowed.
   */
  protected construct(
    provider: DatabaseProvider,
    owner: any,
    relations: unknown,
  ): unknown {
    const connection = provider.db as any;
    const DatabaseClass = this.databaseClassOf(provider);

    if (!DatabaseClass) {
      throw new AlephaError(
        `Cannot build a relational query builder for driver '${provider.driver}'.`,
      );
    }

    if (provider.dialect === "sqlite") {
      return new DatabaseClass(
        connection.resultKind ?? "async",
        owner.dialect ?? connection.dialect,
        owner.session ?? connection.session,
        relations,
        connection.forbidJsonb ?? false,
      );
    }

    return new DatabaseClass(
      owner.dialect ?? connection.dialect,
      owner.session ?? connection.session,
      relations,
      connection.parseRqbJson ?? false,
    );
  }

  protected databaseClassOf(provider: DatabaseProvider): any | undefined {
    const connection = provider.db as any;
    if (!connection) return undefined;

    const ctor = Object.getPrototypeOf(connection)?.constructor;
    return typeof ctor === "function" ? ctor : undefined;
  }
}

export interface RqbQuery {
  where?: unknown;
  orderBy?: unknown;
  limit?: number;
  offset?: number;
  select?: ReadonlyArray<string>;
  include?: Record<string, any>;
}
