import type { SQL } from "drizzle-orm";
import type {
  PgSequenceOptions,
  UpdateDeleteAction,
} from "drizzle-orm/pg-core";
import type { EntityPrimitive } from "../primitives/$entity.ts";

export const PG_DEFAULT = Symbol.for("Alepha.Postgres.Default");
export const PG_PRIMARY_KEY = Symbol.for("Alepha.Postgres.PrimaryKey");
export const PG_CREATED_AT = Symbol.for("Alepha.Postgres.CreatedAt");
export const PG_UPDATED_AT = Symbol.for("Alepha.Postgres.UpdatedAt");
export const PG_DELETED_AT = Symbol.for("Alepha.Postgres.DeletedAt");
export const PG_VERSION = Symbol.for("Alepha.Postgres.Version");
export const PG_IDENTITY = Symbol.for("Alepha.Postgres.Identity");
export const PG_ENUM = Symbol.for("Alepha.Postgres.Enum");
export const PG_REF = Symbol.for("Alepha.Postgres.Ref");
export const PG_GENERATED = Symbol.for("Alepha.Postgres.Generated");
export const PG_ORGANIZATION = Symbol.for("Alepha.Postgres.Organization");

/**
 * @deprecated Use `PG_IDENTITY` instead.
 */
export const PG_SERIAL = Symbol.for("Alepha.Postgres.Serial");

export type PgDefault = typeof PG_DEFAULT;
export type PgRef = typeof PG_REF;
export type PgPrimaryKey = typeof PG_PRIMARY_KEY;

export type PgSymbols = {
  [PG_DEFAULT]: {};
  [PG_PRIMARY_KEY]: {};
  [PG_CREATED_AT]: {};
  [PG_UPDATED_AT]: {};
  [PG_DELETED_AT]: {};
  [PG_VERSION]: {};
  [PG_IDENTITY]: PgIdentityOptions;
  [PG_REF]: PgRefOptions;
  [PG_ENUM]: PgEnumOptions;
  [PG_GENERATED]: PgGeneratedOptions;
  [PG_ORGANIZATION]: PgOrganizationOptions;

  /**
   * @deprecated Use `PG_IDENTITY` instead.
   */
  [PG_SERIAL]: {};
};

export type PgSymbolKeys = keyof PgSymbols;

export interface PgOrganizationOptions {
  /**
   * Fail-closed tenant scoping. When `true`, the repository (a) refuses any
   * read/write with no resolved tenant instead of falling through to an
   * unfiltered "see/write everything" query, and (b) drops the
   * `OR organizationId IS NULL` "global row" escape — a scoped tenant never
   * sees NULL/global rows. Use for security-sensitive tables. Defaults to
   * `false` (the historic fail-open semantics).
   */
  strict?: boolean;
}

export type PgIdentityOptions = {
  mode: "always" | "byDefault";
} & PgSequenceOptions & {
    name?: string;
  };

export interface PgEnumOptions {
  name?: string;
  description?: string;
}

export interface PgGeneratedOptions {
  /**
   * SQL expression for the generated column.
   */
  expression: SQL;

  /**
   * Storage mode for the generated column.
   * - `"stored"` — value is computed on write and stored on disk (default for PostgreSQL).
   * - `"virtual"` — value is computed on read (default for SQLite).
   */
  mode?: "stored" | "virtual";
}

export interface PgRefOptions {
  ref: () => {
    name: string;
    entity: EntityPrimitive;
  };
  actions?: {
    onUpdate?: UpdateDeleteAction;
    onDelete?: UpdateDeleteAction;
  };
}
