/**
 * Type-only spike: why Alepha's derived tables lose column types, and whether
 * that is fixable.
 *
 * `SchemaToTableConfig` declares every column as a bare `PgColumn`. That looks
 * harmless, but `PgColumn`'s FIRST type parameter is the column's data type
 * and the config is the SECOND — so a bare `PgColumn` defaults both away, and
 * every column's value type is gone before Drizzle ever sees it.
 *
 * That single fact explains two separate symptoms: RQB returning `unknown` for
 * every column, and Alepha's own `columns:` projection never narrowing a
 * result type.
 *
 * This file proves the fix works: derive a properly parameterised column from
 * a plain row type — which Alepha already has as `Static<T>` — and inference
 * comes back in full, nullability included. `tsc` passing is the result.
 */
import { defineRelations } from "drizzle-orm";
import type { PgColumn, PgTableWithColumns } from "drizzle-orm/pg-core";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async/db";

/** Map a TS value type onto Drizzle's dataType tag. */
type DataTypeOf<T> = T extends string
  ? "string"
  : T extends number
    ? "number"
    : T extends boolean
      ? "boolean"
      : T extends bigint
        ? "bigint"
        : T extends Array<any>
          ? "array"
          : "object";

/** A column that actually carries its value type. */
type Col<TName extends string, TTable extends string, TData> = PgColumn<
  DataTypeOf<NonNullable<TData>>,
  {
    name: TName;
    tableName: TTable;
    dataType: DataTypeOf<NonNullable<TData>>;
    columnType: string;
    data: NonNullable<TData>;
    driverParam: unknown;
    notNull: undefined extends TData ? false : true;
    hasDefault: false;
    isPrimaryKey: false;
    isAutoincrement: false;
    hasRuntimeDefault: false;
    enumValues: undefined;
    generated: undefined;
    identity: undefined;
  }
>;

/** Build the whole table type from a plain row type — what Alepha has via Static<T>. */
type TableOf<
  TName extends string,
  TRow extends Record<string, any>,
> = PgTableWithColumns<{
  name: TName;
  schema: undefined;
  dialect: "pg";
  columns: { [K in keyof TRow & string]: Col<K, TName, TRow[K]> };
}>;

type UserRow = { id: number; name: string };
type CampaignRow = {
  id: number;
  title: string;
  ownerId: number;
  note?: string;
};

const tables = {
  users: {} as TableOf<"users", UserRow>,
  campaigns: {} as TableOf<"campaigns", CampaignRow>,
};

const rel = defineRelations(tables, (r) => ({
  campaigns: {
    owner: r.one.users({ from: r.campaigns.ownerId, to: r.users.id }),
  },
}));

type Db = SQLiteAsyncDatabase<"sync", unknown, typeof rel>;

export const check = async (db: Db) => {
  const rows = await db.query.campaigns.findMany({ with: { owner: true } });
  const title: string = rows[0]!.title; // string ?
  const ownerName: string | undefined = rows[0]!.owner?.name;
  const optional: string | null | undefined = rows[0]!.note; // nullable respecté ?
  return [title, ownerName, optional];
};
