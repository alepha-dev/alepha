import {
  AlephaError,
  type Static,
  type TArray,
  type TBigInt,
  type TInteger,
  type TNumber,
  type TNumberOptions,
  type TObject,
  type TObjectOptions,
  type TOptionalAdd,
  type TSchema,
  type TString,
  type TStringOptions,
  t,
} from "@alepha/core";
import type { TableConfig } from "drizzle-orm";
import type { UpdateDeleteAction } from "drizzle-orm/pg-core/foreign-keys";
import {
  PG_CREATED_AT,
  PG_DEFAULT,
  PG_DELETED_AT,
  PG_IDENTITY,
  PG_MANY,
  PG_ONE,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_UPDATED_AT,
  PG_VERSION,
  type PgDefault,
  type PgIdentityOptions,
  type PgMany,
  type PgOne,
  type PgPrimaryKey,
  type PgRef,
} from "../constants/PG_SYMBOLS.ts";
import type { PgAttr } from "../helpers/pgAttr.ts";
import { pgAttr } from "../helpers/pgAttr.ts";
import type { PgTableWithColumnsAndSchema } from "../helpers/schemaToPgColumns.ts";
import type { TPage } from "../schemas/pageSchema.ts";
import { pageSchema } from "../schemas/pageSchema.ts";

export class PostgresTypeProvider {
  public readonly attr = pgAttr;

  /**
   * Creates a primary key with an identity column.
   */
  public readonly identityPrimaryKey = (
    identity?: PgIdentityOptions,
    options?: TNumberOptions,
  ) =>
    pgAttr(
      pgAttr(pgAttr(t.int(options), PG_PRIMARY_KEY), PG_IDENTITY, identity),
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
   * - `t.int()` -> PG INT (default)
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
        pgAttr(pgAttr(t.int(options), PG_PRIMARY_KEY), PG_IDENTITY, identity),
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
   * You can use it for optimistic concurrency control (OCC) with {@link RepositoryDescriptor#save}.
   *
   * @see {@link RepositoryDescriptor#save}
   * @see {@link PgVersionMismatchError}
   */
  public readonly version = (options: TNumberOptions = {}) =>
    this.default(pgAttr(t.int(options), PG_VERSION), 0);

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
   * It's used by {@link RepositoryDescriptor#paginate} method.
   */
  public readonly page = <T extends TObject>(
    resource: T,
    options?: TObjectOptions,
  ): TPage<T> => {
    return pageSchema(resource, options);
  };

  // -------------------------------------------------------------------------------------------------------------------
  // Experimental - Relations / Joins

  public readonly many = <T extends TObject, Config extends TableConfig>(
    table: PgTableWithColumnsAndSchema<Config, T>,
    foreignKey: keyof T["properties"],
  ): TOptionalAdd<PgAttr<PgAttr<TArray<T>, PgMany>, PgDefault>> => {
    return this.attr(
      this.attr(t.optional(t.array(table.$schema)), PG_DEFAULT),
      PG_MANY,
      {
        table,
        schema: table.$schema,
        foreignKey: foreignKey as string,
      },
    );
  };

  public readonly one = <T extends TObject, Config extends TableConfig>(
    table: PgTableWithColumnsAndSchema<Config, T>,
    foreignKey: keyof T["properties"],
  ): PgAttr<PgAttr<TOptionalAdd<T>, PgOne>, PgDefault> => {
    return this.attr(this.attr(t.optional(table.$schema), PG_DEFAULT), PG_ONE, {
      table,
      schema: table.$schema,
      foreignKey: foreignKey as string,
    });
  };
}

export const pg = new PostgresTypeProvider();
