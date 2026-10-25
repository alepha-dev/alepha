import { type Infer, type ZObject, z } from "alepha";
import { KIND } from "alepha/internal";
import type { SQL } from "drizzle-orm";

import type { PgQueryWhere } from "../interfaces/PgQueryWhere.ts";
import { insertSchema, type TObjectInsert } from "../schemas/insertSchema.ts";
import { type TObjectUpdate, updateSchema } from "../schemas/updateSchema.ts";
import type { IndexExpressionContext } from "../services/ModelBuilder.ts";

/**
 * Creates a database entity primitive that defines table structure using Zod schemas.
 *
 * @example
 * ```ts
 * import { z } from "alepha";
 * import { $entity, db } from "alepha/orm";
 *
 * const userEntity = $entity({
 *   name: "users",
 *   schema: z.object({
 *     id: db.primaryKey(),
 *     name: z.text(),
 *     email: z.email(),
 *   }),
 * });
 * ```
 */
export const $entity = <ZType extends ZObject>(
  options: EntityPrimitiveOptions<ZType>,
): EntityPrimitive<ZType> => {
  return new EntityPrimitive<ZType>(options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface EntityPrimitiveOptions<
  T extends ZObject,
  Keys = keyof Infer<T>,
> {
  /**
   * The database table name that will be created for this entity.
   * If not provided, name will be inferred from the $repository variable name.
   */
  name: string;

  /**
   * Zod schema defining the table structure and column types.
   */
  schema: T;

  /**
   * Database indexes to create for query optimization.
   */
  indexes?: (
    | Keys
    | {
        /**
         * Single column to index.
         */
        column: Keys;
        /**
         * Whether this should be a unique index (enforces uniqueness constraint).
         */
        unique?: boolean;
        /**
         * Custom name for the index. If not provided, generates name automatically.
         */
        name?: string;
        /**
         * Partial index condition: only rows matching it are indexed.
         *
         * A where-object (`{ deletedAt: { isNull: true } }`) is compiled
         * against this entity's columns, so a column rename cannot leave it
         * stale; its values are inlined, since an index predicate binds no
         * parameters. Column operators and `and` / `or` / `not` only: a
         * subquery, a join or a nested raw fragment is refused. No soft-delete
         * filter is added. A raw `SQL` is still accepted as the whole
         * condition.
         *
         * ⚠️ Moving a hand-typed predicate (`deleted_at IS NULL` in a raw
         * `sql` template) to the object changes its text (identifiers come
         * out quoted), so the next generated migration recreates the index
         * once.
         */
        where?: IndexWhere<T>;
      }
    | {
        /**
         * Multiple columns for composite index (order matters for query optimization).
         */
        columns: Keys[];
        /**
         * Whether this should be a unique index (enforces uniqueness constraint).
         */
        unique?: boolean;
        /**
         * Custom name for the index. If not provided, generates name automatically.
         */
        name?: string;
        /**
         * Partial index condition: only rows matching it are indexed.
         *
         * A where-object (`{ deletedAt: { isNull: true } }`) is compiled
         * against this entity's columns, so a column rename cannot leave it
         * stale; its values are inlined, since an index predicate binds no
         * parameters. Column operators and `and` / `or` / `not` only: a
         * subquery, a join or a nested raw fragment is refused. No soft-delete
         * filter is added. A raw `SQL` is still accepted as the whole
         * condition.
         *
         * ⚠️ Moving a hand-typed predicate (`deleted_at IS NULL` in a raw
         * `sql` template) to the object changes its text (identifiers come
         * out quoted), so the next generated migration recreates the index
         * once.
         */
        where?: IndexWhere<T>;
      }
    | {
        /**
         * SQL expressions for expression-based indexes.
         *
         * Can include column references and SQL functions like `LOWER()`, `UPPER()`, etc.
         * Columns and expressions can be mixed together.
         *
         * The second argument carries the dialect and the helpers that need
         * it. Reach for `ctx.caseInsensitive` rather than writing `LOWER()`
         * by hand: on sqlite a MULTI-column unique index containing an
         * expression is one drizzle-kit v1 cannot introspect at all, and it
         * takes `push` and the dev-mode `DATABASE_SYNC` down with it. See
         * {@link IndexExpressionContext}.
         *
         * @example
         * ```ts
         * // Case-insensitive unique username per realm
         * indexes: [{
         *   expressions: (self, ctx) => [self.realm, ctx.caseInsensitive(self.username)],
         *   unique: true,
         *   name: "users_realm_username_ci_idx",
         * }]
         * ```
         */
        expressions: (
          self: Record<Keys & string, any>,
          ctx: IndexExpressionContext,
        ) => any[];
        /**
         * Whether this should be a unique index (enforces uniqueness constraint).
         */
        unique?: boolean;
        /**
         * Custom name for the index. If not provided, generates name automatically.
         */
        name: string;
        /**
         * Partial index condition: only rows matching it are indexed.
         *
         * A where-object (`{ deletedAt: { isNull: true } }`) is compiled
         * against this entity's columns, so a column rename cannot leave it
         * stale; its values are inlined, since an index predicate binds no
         * parameters. Column operators and `and` / `or` / `not` only: a
         * subquery, a join or a nested raw fragment is refused. No soft-delete
         * filter is added. A raw `SQL` is still accepted as the whole
         * condition.
         *
         * ⚠️ Moving a hand-typed predicate (`deleted_at IS NULL` in a raw
         * `sql` template) to the object changes its text (identifiers come
         * out quoted), so the next generated migration recreates the index
         * once.
         */
        where?: IndexWhere<T>;
      }
  )[];

  /**
   * Foreign key constraints to maintain referential integrity.
   */
  foreignKeys?: Array<{
    /**
     * Optional name for the foreign key constraint.
     */
    name?: string;
    /**
     * Local columns that reference the foreign table.
     */
    columns: Array<keyof Infer<T>>;
    /**
     * Referenced columns in the foreign table.
     * Must be EntityColumn references from other entities.
     */
    foreignColumns: Array<() => EntityColumn<any>>;
  }>;

  /**
   * Additional table constraints for data validation.
   *
   * Constraints enforce business rules at the database level, providing
   * an additional layer of data integrity beyond application validation.
   *
   * **Constraint Types**:
   * - **Unique constraints**: Prevent duplicate values across columns
   * - **Check constraints**: Enforce custom validation rules with SQL expressions
   *
   * @example
   * ```ts
   * constraints: [
   *   {
   *     name: "unique_user_email",
   *     columns: ["email"],
   *     unique: true
   *   },
   *   {
   *     name: "valid_age_range",
   *     columns: ["age"],
   *     check: sql`age >= 0 AND age <= 150`
   *   },
   *   {
   *     name: "unique_user_username_per_tenant",
   *     columns: ["tenantId", "username"],
   *     unique: true
   *   }
   * ]
   * ```
   */
  constraints?: Array<{
    /**
     * Columns involved in this constraint.
     */
    columns: Array<keyof Infer<T>>;
    /**
     * Optional name for the constraint.
     */
    name?: string;
    /**
     * Whether this is a unique constraint.
     */
    unique?: boolean | {} /* options */;
    /**
     * SQL expression for check constraint validation.
     */
    check?: SQL;
  }>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class EntityPrimitive<T extends ZObject = ZObject> {
  public readonly options: EntityPrimitiveOptions<T>;

  constructor(options: EntityPrimitiveOptions<T>) {
    this.options = options;
  }

  alias(alias: string): this {
    const aliased = new EntityPrimitive<T>(this.options);
    return new Proxy(aliased, {
      get(target, prop, receiver) {
        if (prop === "$alias") {
          return alias;
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as this;
  }

  get cols(): EntityColumns<T> {
    const cols: Partial<EntityColumns<T>> = {};
    for (const key of Object.keys(z.schema.shape(this.schema)) as Array<
      keyof T["shape"]
    >) {
      cols[key] = {
        name: key as string,
        entity: this,
      };
    }

    return cols as EntityColumns<T>;
  }

  get name(): string {
    return this.options.name;
  }

  get schema(): T {
    return this.options.schema;
  }

  protected cachedInsertSchema?: TObjectInsert<T>;
  get insertSchema(): TObjectInsert<T> {
    this.cachedInsertSchema ??= insertSchema(this.options.schema);
    return this.cachedInsertSchema;
  }

  protected cachedUpdateSchema?: TObjectUpdate<T>;
  get updateSchema(): TObjectUpdate<T> {
    this.cachedUpdateSchema ??= updateSchema(this.options.schema);
    return this.cachedUpdateSchema;
  }
}

$entity[KIND] = EntityPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export type EntityColumn<T extends ZObject> = {
  name: string;
  entity: EntityPrimitive<T>;
};

export type EntityColumns<T extends ZObject> = {
  [key in keyof T["shape"]]: EntityColumn<T>;
};

/**
 * A partial index condition: a raw `SQL`, or a where-object compiled against
 * the entity's columns with its values inlined.
 */
export type IndexWhere<T extends ZObject> = SQL | PgQueryWhere<T>;
