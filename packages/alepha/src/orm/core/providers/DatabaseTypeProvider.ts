import {
  AlephaError,
  pageSchema,
  type Static,
  type TBigInt,
  type TInteger,
  type TNumber,
  type TNumberOptions,
  type TObject,
  type TObjectOptions,
  type TPage,
  type TSchema,
  type TString,
  type TStringOptions,
  type TUnsafe,
  t,
} from "alepha";
import type { UpdateDeleteAction } from "drizzle-orm/pg-core/foreign-keys";
import {
  PG_CREATED_AT,
  PG_DEFAULT,
  PG_DELETED_AT,
  PG_ENUM,
  PG_IDENTITY,
  PG_ORGANIZATION,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_UPDATED_AT,
  PG_VERSION,
  type PgDefault,
  type PgEnumOptions,
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
  public readonly identityPrimaryKey = (
    identity?: PgIdentityOptions,
    options?: TNumberOptions,
  ) =>
    pgAttr(
      pgAttr(pgAttr(t.integer(options), PG_PRIMARY_KEY), PG_IDENTITY, identity),
      PG_DEFAULT,
    );

  /**
   * Creates a primary key with a big identity column. (default)
   */
  public readonly bigIdentityPrimaryKey = (
    identity?: PgIdentityOptions,
    options?: TNumberOptions,
  ) =>
    pgAttr(
      pgAttr(pgAttr(t.int64(options), PG_PRIMARY_KEY), PG_IDENTITY, identity),
      PG_DEFAULT,
    );

  /**
   * Creates a primary key with a UUID column.
   */
  public readonly uuidPrimaryKey = () =>
    pgAttr(pgAttr(t.uuid(), PG_PRIMARY_KEY), PG_DEFAULT);

  /**
   * Creates a primary key for a given type. Supports:
   * - `t.integer()` -> PG INT (default)
   * - `t.bigint()` -> PG BIGINT
   * - `t.uuid()` -> PG UUID
   */
  public primaryKey(): PgAttr<PgAttr<TInteger, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type: TString,
    options?: TStringOptions,
  ): PgAttr<PgAttr<TString, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type: TInteger,
    options?: TNumberOptions,
    identity?: PgIdentityOptions,
  ): PgAttr<PgAttr<TInteger, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type: TNumber,
    options?: TNumberOptions,
    identity?: PgIdentityOptions,
  ): PgAttr<PgAttr<TNumber, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type: TBigInt,
    options?: TNumberOptions,
    identity?: PgIdentityOptions,
  ): PgAttr<PgAttr<TBigInt, PgPrimaryKey>, PgDefault>;
  public primaryKey(
    type?: TSchema,
    options?: TNumberOptions | TStringOptions,
    identity?: PgIdentityOptions,
  ): PgAttr<PgAttr<TSchema, PgPrimaryKey>, PgDefault> {
    if (!type || t.schema.isInteger(type)) {
      return pgAttr(
        pgAttr(
          pgAttr(t.integer(options), PG_PRIMARY_KEY),
          PG_IDENTITY,
          identity,
        ),
        PG_DEFAULT,
      );
    }

    if (t.schema.isString(type) && type.format === "uuid") {
      return pgAttr(pgAttr(t.uuid(), PG_PRIMARY_KEY), PG_DEFAULT);
    }

    if (t.schema.isNumber(type) && type.format === "int64") {
      return pgAttr(
        pgAttr(
          pgAttr(t.number(options), PG_PRIMARY_KEY),
          PG_IDENTITY,
          identity,
        ),
        PG_DEFAULT,
      );
    }

    if (t.schema.isBigInt(type)) {
      return pgAttr(
        pgAttr(
          pgAttr(t.bigint(options), PG_PRIMARY_KEY),
          PG_IDENTITY,
          identity,
        ),
        PG_DEFAULT,
      );
    }

    throw new AlephaError(`Unsupported type for primary key: ${type}`);
  }

  /**
   * Wrap a schema with "default" attribute.
   * This is used to set a default value for a column in the database.
   */
  public readonly default = <T extends TSchema>(
    type: T,
    value?: Static<T>,
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
  public readonly version = (options: TNumberOptions = {}) =>
    this.default(pgAttr(t.integer(options), PG_VERSION), 0);

  /**
   * Creates a column Created At. So just a datetime column with a default value of the current timestamp.
   */
  public readonly createdAt = (options?: TStringOptions) =>
    pgAttr(pgAttr(t.datetime(options), PG_CREATED_AT), PG_DEFAULT);

  /**
   * Creates a column Updated At. Like createdAt, but it is updated on every update of the row.
   */
  public readonly updatedAt = (options?: TStringOptions) =>
    pgAttr(pgAttr(t.datetime(options), PG_UPDATED_AT), PG_DEFAULT);

  /**
   * Creates a column Deleted At for soft delete functionality.
   * This is used to mark rows as deleted without actually removing them from the database.
   * The column is nullable - NULL means not deleted, timestamp means deleted.
   */
  public readonly deletedAt = (options?: TStringOptions) =>
    pgAttr(t.optional(t.datetime(options)), PG_DELETED_AT);

  /**
   * Creates an organization column for multi-tenant row scoping.
   *
   * When present, queries are automatically filtered by the current user's organization.
   * Rows with `null` organization are considered global and visible to everyone.
   * On create, the column is auto-stamped with the current user's organization.
   */
  public readonly organization = () =>
    pgAttr(t.optional(t.uuid()), PG_ORGANIZATION);

  /**
   * Creates a Postgres ENUM type.
   *
   * > By default, `t.enum()` is mapped to a TEXT column in Postgres.
   * > Using this method, you can create a real ENUM type in the database.
   *
   * @example
   * ```ts
   * const statusEnum = pg.enum(["pending", "active", "archived"], { name: "status_enum" });
   * ```
   */
  public readonly enum = <T extends string[]>(
    values: [...T],
    pgEnumOptions?: PgEnumOptions,
    typeOptions?: TStringOptions,
  ): PgAttr<TUnsafe<T[number]>, typeof PG_ENUM> => {
    return pgAttr(
      t.enum(values, {
        description: pgEnumOptions?.description,
        ...typeOptions,
      }),
      PG_ENUM,
      pgEnumOptions,
    );
  };

  /**
   * Creates a reference to another table or schema. Basically a foreign key.
   */
  public readonly ref = <T extends TSchema>(
    type: T,
    ref: () => any,
    actions?: {
      onUpdate?: UpdateDeleteAction;
      onDelete?: UpdateDeleteAction;
    },
  ): PgAttr<T, PgRef> => {
    // If actions are not provided, set default onDelete based on type
    const finalActions = actions ?? {
      onDelete: t.schema.isOptional(type) ? "set null" : "cascade",
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
  public readonly page = <T extends TObject>(
    resource: T,
    options?: TObjectOptions,
  ): TPage<T> => {
    return pageSchema(resource, options);
  };
}

/**
 * Wrapper of TypeProvider (`t`) for database types.
 *
 * Use `db` for improve TypeBox schema definitions with database-specific attributes.
 *
 * @example
 * ```ts
 * import { t } from "alepha";
 * import { db } from "alepha/orm";
 *
 * const userSchema = t.object({
 *   id: db.primaryKey(t.uuid()),
 *   email: t.email(),
 *   createdAt: db.createdAt(),
 * });
 * ```
 */
export const db = new DatabaseTypeProvider();
