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

import {
  PG_CREATED_AT,
  PG_DEFAULT,
  PG_DELETED_AT,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_UPDATED_AT,
  PG_VERSION,
  type PgDefault,
  type PgIdentityOptions,
  type PgPrimaryKey,
  type PgRef,
  type PgSymbolKeys,
  type PgSymbols,
} from "../constants/PG_SYMBOLS.ts";
import type { PgAttr } from "../helpers/pgAttr.ts";
import { pgAttr } from "../helpers/pgAttr.ts";
import type { ForeignKeyAction } from "../interfaces/ForeignKeyAction.ts";

export class DatabaseTypeProvider {
  /**
   * Tags a schema with a Postgres attribute in place, and returns it.
   *
   * Only for a type a helper of this class builds in the same expression
   * (`DatabaseTypeProvider.tag(z.datetime(), PG_CREATED_AT)`): nothing else
   * holds it, so a copy would only cost a second schema. It stays off the
   * public API because it mutates what it is given; a schema that came from
   * a caller goes through {@link pgAttr}, which leaves it alone.
   */
  protected static tag<T extends ZType, Attr extends PgSymbolKeys>(
    type: T,
    attr: Attr,
    value?: PgSymbols[Attr],
  ): PgAttr<T, Attr> {
    Object.assign(type, { [attr]: value ?? {} });
    return type as PgAttr<T, Attr>;
  }

  public readonly attr = pgAttr;

  /**
   * Creates a primary key with an identity column.
   */
  public readonly identityPrimaryKey = (identity?: PgIdentityOptions) =>
    DatabaseTypeProvider.tag(
      DatabaseTypeProvider.tag(
        DatabaseTypeProvider.tag(z.integer(), PG_PRIMARY_KEY),
        PG_IDENTITY,
        identity,
      ),
      PG_DEFAULT,
    );

  /**
   * Creates a primary key with a big identity column. (default)
   */
  public readonly bigIdentityPrimaryKey = (identity?: PgIdentityOptions) =>
    DatabaseTypeProvider.tag(
      DatabaseTypeProvider.tag(
        DatabaseTypeProvider.tag(z.int64(), PG_PRIMARY_KEY),
        PG_IDENTITY,
        identity,
      ),
      PG_DEFAULT,
    );

  /**
   * Creates a primary key with a UUID column.
   */
  public readonly uuidPrimaryKey = () =>
    DatabaseTypeProvider.tag(
      DatabaseTypeProvider.tag(z.uuid(), PG_PRIMARY_KEY),
      PG_DEFAULT,
    );

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
      return DatabaseTypeProvider.tag(
        DatabaseTypeProvider.tag(z.uuid(), PG_PRIMARY_KEY),
        PG_DEFAULT,
      );
    }

    if (z.schema.isInteger(type)) {
      return DatabaseTypeProvider.tag(
        DatabaseTypeProvider.tag(
          DatabaseTypeProvider.tag(z.integer(), PG_PRIMARY_KEY),
          PG_IDENTITY,
          identity,
        ),
        PG_DEFAULT,
      );
    }

    if (z.schema.isString(type) && z.schema.format(type) === "uuid") {
      return DatabaseTypeProvider.tag(
        DatabaseTypeProvider.tag(z.uuid(), PG_PRIMARY_KEY),
        PG_DEFAULT,
      );
    }

    if (z.schema.isNumber(type) && z.schema.format(type) === "int64") {
      return DatabaseTypeProvider.tag(
        DatabaseTypeProvider.tag(
          DatabaseTypeProvider.tag(z.number(), PG_PRIMARY_KEY),
          PG_IDENTITY,
          identity,
        ),
        PG_DEFAULT,
      );
    }

    if (z.schema.isBigInt(type)) {
      return DatabaseTypeProvider.tag(
        DatabaseTypeProvider.tag(
          DatabaseTypeProvider.tag(z.bigint(), PG_PRIMARY_KEY),
          PG_IDENTITY,
          identity,
        ),
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
    const tagged = this.attr(type, PG_DEFAULT);
    if (value != null) {
      Object.assign(tagged, { default: value });
    }
    return tagged;
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
  public readonly version = () => {
    const type = DatabaseTypeProvider.tag(
      DatabaseTypeProvider.tag(z.integer(), PG_VERSION),
      PG_DEFAULT,
    );
    Object.assign(type, { default: 0 });
    return type;
  };

  /**
   * Creates a column Created At. So just a datetime column with a default value of the current timestamp.
   */
  public readonly createdAt = () =>
    DatabaseTypeProvider.tag(
      DatabaseTypeProvider.tag(z.datetime(), PG_CREATED_AT),
      PG_DEFAULT,
    );

  /**
   * Creates a column Updated At. Like createdAt, but it is updated on every update of the row.
   */
  public readonly updatedAt = () =>
    DatabaseTypeProvider.tag(
      DatabaseTypeProvider.tag(z.datetime(), PG_UPDATED_AT),
      PG_DEFAULT,
    );

  /**
   * Creates a column Deleted At for soft delete functionality.
   * This is used to mark rows as deleted without actually removing them from the database.
   * The column is nullable - NULL means not deleted, timestamp means deleted.
   */
  public readonly deletedAt = () =>
    DatabaseTypeProvider.tag(z.datetime().optional(), PG_DELETED_AT);

  /**
   * Creates a reference to another table or schema. Basically a foreign key.
   *
   * Without `actions`, `onDelete` is `"set null"` when the column is
   * optional and `"cascade"` otherwise. It is decided from the column as the
   * entity declares it, so `db.ref(x).optional()` and `db.ref(x.optional())`
   * are the same column.
   */
  public readonly ref = <T extends ZType>(
    type: T,
    ref: () => any,
    actions?: {
      onUpdate?: ForeignKeyAction;
      onDelete?: ForeignKeyAction;
    },
  ): PgAttr<T, PgRef> => {
    return this.attr(type, PG_REF, { ref, actions });
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
