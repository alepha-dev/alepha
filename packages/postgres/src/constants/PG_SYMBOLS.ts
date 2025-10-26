import type {
  PgSequenceOptions,
  UpdateDeleteAction,
} from "drizzle-orm/pg-core";
import type { EntityDescriptor } from "../descriptors/$entity.ts";

export const PG_DEFAULT = Symbol.for("Alepha.Postgres.Default");
export const PG_PRIMARY_KEY = Symbol.for("Alepha.Postgres.PrimaryKey");
export const PG_CREATED_AT = Symbol.for("Alepha.Postgres.CreatedAt");
export const PG_UPDATED_AT = Symbol.for("Alepha.Postgres.UpdatedAt");
export const PG_DELETED_AT = Symbol.for("Alepha.Postgres.DeletedAt");
export const PG_VERSION = Symbol.for("Alepha.Postgres.Version");
export const PG_IDENTITY = Symbol.for("Alepha.Postgres.Identity");
export const PG_ENUM = Symbol.for("Alepha.Postgres.Enum");
export const PG_REF = Symbol.for("Alepha.Postgres.Ref");

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

  /**
   * @deprecated Use `PG_IDENTITY` instead.
   */
  [PG_SERIAL]: {};
};

export type PgSymbolKeys = keyof PgSymbols;

export type PgIdentityOptions = {
  mode: "always" | "byDefault";
} & PgSequenceOptions & {
    name?: string;
  };

export interface PgEnumOptions {
  name?: string;
}

export interface PgRefOptions {
  ref: () => {
    name: string;
    entity: EntityDescriptor;
  };
  actions?: {
    onUpdate?: UpdateDeleteAction;
    onDelete?: UpdateDeleteAction;
  };
}
