import {
  AlephaError,
  type Infer,
  type NumberOptions,
  pageSchema,
  type StringOptions,
  type TPage,
  type ZObject,
  type ZodNumber,
  type ZodString,
  type ZType,
  z,
} from "alepha";
import type { UpdateDeleteAction } from "drizzle-orm/pg-core/foreign-keys";

import {
  PG_CREATED_AT,
  PG_DEFAULT,
  PG_DELETED_AT,
  PG_IDENTITY,
  PG_ORGANIZATION,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_UPDATED_AT,
  PG_VERSION,
  type PgDefault,
  type PgIdentityOptions,
  type PgPrimaryKey,
  type PgRef,
} from "../constants/PG_SYMBOLS.ts";
import type { PgAttr } from "../helpers/pgAttr.ts";
import { pgAttr } from "../helpers/pgAttr.ts";

export class DatabaseTypeProvider {
  public readonly attr = pgAttr;

  /**
   * Creates a primary key with an identity column.
   */
  public readonly identityPrimaryKey = (identity?: PgIdentityOptions) =>
    pgAttr(
      pgAttr(pgAttr(z.integer(), PG_PRIMARY_KEY), PG_IDENTITY, identity),
      PG_DEFAULT,
    );

  /**
   * Creates a primary key with a big identity column. (default)
   */
  public readonly bigIdentityPrimaryKey = (identity?: PgIdentityOptions) =>
    pgAttr(
      pgAttr(pgAttr(z.int64(), PG_PRIMARY_KEY), PG_IDENTITY, identity),
      PG_DEFAULT,
    );

  /**
   * Creates a primary key with a UUID column.
   */
  public readonly uuidPrimaryKey = () =>
    pgAttr(pgAttr(z.uuid(), PG_PRIMARY_KEY), PG_DEFAULT);

  /**
   * Creates a primary key for a given type. Supports:
   * - no argument -> UUID, generated app-side as a time-ordered UUIDv7 (default)
   * - `z.uuid()` -> UUID, same app-side UUIDv7 generation
   * - `z.integer()` -> PG INT identity
   * - `z.bigint()` -> PG BIGINT identity
   */
  public primaryKey(): PgAttr<PgAttr<ZodString, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type: ZodString,
    options?: StringOptions,
  ): PgAttr<PgAttr<ZodString, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type: ZodNumber,
    options?: NumberOptions,
    identity?: PgIdentityOptions,
  ): PgAttr<PgAttr<ZodNumber, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type: ZodNumber,
    options?: NumberOptions,
    identity?: PgIdentityOptions,
  ): PgAttr<PgAttr<ZodNumber, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type: ZodString,
    options?: NumberOptions,
    identity?: PgIdentityOptions,
  ): PgAttr<PgAttr<ZodString, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type?: ZType,
    _options?: NumberOptions | StringOptions,
    identity?: PgIdentityOptions,
  ): PgAttr<PgAttr<ZType, PgPrimaryKey>, PgDefault> {
    if (!type) {
      return pgAttr(pgAttr(z.uuid(), PG_PRIMARY_KEY), PG_DEFAULT);
    }

    if (z.schema.isInteger(type)) {
      return pgAttr(
        pgAttr(pgAttr(z.integer(), PG_PRIMARY_KEY), PG_IDENTITY, identity),
        PG_DEFAULT,
      );
    }

    if (z.schema.isString(type) && z.schema.format(type) === "uuid") {
      return pgAttr(pgAttr(z.uuid(), PG_PRIMARY_KEY), PG_DEFAULT);
    }

    if (z.schema.isNumber(type) && z.schema.format(type) === "int64") {
      return pgAttr(
        pgAttr(pgAttr(z.number(), PG_PRIMARY_KEY), PG_IDENTITY, identity),
        PG_DEFAULT,
      );
    }

    if (z.schema.isBigInt(type)) {
      return pgAttr(
        pgAttr(pgAttr(z.bigint(), PG_PRIMARY_KEY), PG_IDENTITY, identity),
        PG_DEFAULT,
      );
    }

    // Plain text primary key (a slug, an external id). Must come after the
    // numeric branches: `z.bigint()` is a ZodString carrying
    // `format: "bigint"`, so a generic string check up front would swallow it
    // and strip its identity default.
    //
    // No PG_DEFAULT: `insertSchema` turns every PG_DEFAULT column optional
    // because the database fills it in, and nothing fills in a slug — the
    // caller does. Marking it default made `create({ label })` pass
    // validation and hand the driver a NULL primary key.
    //
    // The cast is the honest part of a type-level gap: `z.uuid()` and
    // `z.text()` are both `ZodString`, so the single `ZodString` overload above
    // cannot distinguish them and still promises `PgDefault` (right for the
    // 26 uuid PKs in tree, wrong here). A slug PK that omits its id therefore
    // still compiles; it now fails validation instead of reaching the driver.
    // Closing the gap needs a nominal uuid type — tracked in Lore folio #14
    // (Alepha campaign), under "deliberate non-fixes".
    if (z.schema.isString(type)) {
      return pgAttr(type, PG_PRIMARY_KEY) as PgAttr<
        PgAttr<ZType, PgPrimaryKey>,
        PgDefault
      >;
    }

    throw new AlephaError(
      `Unsupported type for primary key: ${JSON.stringify(type)}`,
    );
  }

  /**
   * Wrap a schema with "default" attribute.
   * This is used to set a default value for a column in the database.
   */
  public readonly default = <T extends ZType>(
    type: T,
    value?: Infer<T>,
  ): PgAttr<T, PgDefault> => {
    if (value != null) {
      Object.assign(type, { default: value });
    }

    return this.attr(type, PG_DEFAULT);
  };

  /**
   * Creates a column 'version'.
   *
   * This is used to track the version of a row in the database.
   *
   * You can use it for optimistic concurrency control (OCC) with {@link RepositoryPrimitive#save}.
   *
   * @see {@link RepositoryPrimitive#save}
   * @see {@link PgVersionMismatchError}
   */
  public readonly version = () =>
    this.default(pgAttr(z.integer(), PG_VERSION), 0);

  /**
   * Creates a column Created At. So just a datetime column with a default value of the current timestamp.
   */
  public readonly createdAt = () =>
    pgAttr(pgAttr(z.datetime(), PG_CREATED_AT), PG_DEFAULT);

  /**
   * Creates a column Updated At. Like createdAt, but it is updated on every update of the row.
   */
  public readonly updatedAt = () =>
    pgAttr(pgAttr(z.datetime(), PG_UPDATED_AT), PG_DEFAULT);

  /**
   * Creates a column Deleted At for soft delete functionality.
   * This is used to mark rows as deleted without actually removing them from the database.
   * The column is nullable - NULL means not deleted, timestamp means deleted.
   */
  public readonly deletedAt = () =>
    pgAttr(z.datetime().optional(), PG_DELETED_AT);

  /**
   * Creates an organization column for multi-tenant row scoping.
   *
   * When present, queries are automatically filtered by the current user's organization.
   * On create, the column is auto-stamped with the current user's organization.
   *
   * @param options.nullable - When `false`, the column is NOT NULL in the database and
   *   the ORM rejects inserts that arrive without an organization context.
   *   Defaults to `true` (nullable) — unless `strict` is set, which flips the
   *   default to non-nullable. NULL rows are visible to every tenant (the
   *   historic "global row" semantics) only when the column is nullable AND
   *   not strict.
   * @param options.strict - Fail-closed tenant scoping: refuses reads/writes
   *   with no resolved tenant (instead of a fail-open "see/write everything")
   *   and drops the `OR org IS NULL` escape so a scoped tenant never sees
   *   global rows.
   *
   *   **Omit it unless this entity is genuinely special.** Left unset, the
   *   entity follows the application's `tenancyAtom` mode, which is where the
   *   decision belongs — whether a deployment is multi-tenant is a fact about
   *   the app, not about this table. Set it only to override that per entity:
   *   `true` to fail closed even in a single-tenant app, `false` to stay
   *   lenient inside an otherwise strict one (a shared reference table).
   */
  public readonly organization = (options?: {
    nullable?: boolean;
    strict?: boolean;
  }) => {
    // Kept as `undefined` when unset — that third state is what lets the
    // application's tenancy mode decide, and what tells an explicit
    // `strict: false` (an opt-out) apart from "never said".
    const strict = options?.strict;
    // Nullability stays a schema fact: it is written into the migration, so it
    // cannot depend on a runtime mode. An explicitly strict entity has no
    // "global row" concept and so defaults to NOT NULL; everything else stays
    // nullable, including entities that will fail closed because the app is in
    // `multi` mode. Those two used to be conflated.
    const nullable = options?.nullable ?? strict !== true;
    return pgAttr(nullable ? z.uuid().optional() : z.uuid(), PG_ORGANIZATION, {
      strict,
    });
  };

  /**
   * Creates a reference to another table or schema. Basically a foreign key.
   */
  public readonly ref = <T extends ZType>(
    type: T,
    ref: () => any,
    actions?: {
      onUpdate?: UpdateDeleteAction;
      onDelete?: UpdateDeleteAction;
    },
  ): PgAttr<T, PgRef> => {
    // If actions are not provided, set default onDelete based on type
    const finalActions = actions ?? {
      onDelete: z.schema.isOptional(type) ? "set null" : "cascade",
    };

    return this.attr(type, PG_REF, {
      ref,
      actions: finalActions,
    });
  };

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Creates a page schema for a given object schema.
   * It's used by {@link Repository#paginate} method.
   */
  public readonly page = <T extends ZObject>(resource: T): TPage<T> => {
    return pageSchema(resource);
  };
}

/**
 * Wrapper of the schema provider (`z`) for database types.
 *
 * Use `db` to extend Zod schema definitions with database-specific attributes.
 *
 * @example
 * ```ts
 * import { z } from "alepha";
 * import { db } from "alepha/orm";
 *
 * const userSchema = z.object({
 *   id: db.primaryKey(z.uuid()),
 *   email: z.email(),
 *   createdAt: db.createdAt(),
 * });
 * ```
 */
export const db = new DatabaseTypeProvider();
