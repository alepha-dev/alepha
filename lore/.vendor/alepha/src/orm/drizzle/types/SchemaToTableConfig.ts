import type { Infer, ZObject } from "alepha";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Map a column's TypeScript value onto Drizzle's `dataType` tag.
 *
 * Drizzle's `ColumnDataType` union has no `date` or `json` member — both are
 * `object` there — so anything that is not a primitive lands on `object`.
 */
export type SchemaToDataType<T> = T extends string
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

/**
 * A Drizzle column that still carries its value type.
 *
 * `PgColumn`'s **first** type parameter is the data type and the config is the
 * **second**, so a bare `PgColumn` silently defaults both away. That single
 * detail cost this codebase two separate bugs: query results came back
 * `unknown` through anything that reads the table type, and `columns:`
 * projection never narrowed a result — the compiler kept promising fields that
 * had already been stripped at runtime.
 */
export type SchemaToColumn<
  TName extends string,
  TTable extends string,
  TData,
> = PgColumn<
  SchemaToDataType<NonNullable<TData>>,
  {
    name: TName;
    tableName: TTable;
    dataType: SchemaToDataType<NonNullable<TData>>;
    columnType: string;
    data: NonNullable<TData>;
    driverParam: unknown;
    notNull: undefined extends TData ? false : true;
    /**
     * Always `true`, which is a deliberate looseness on the *insert* side.
     *
     * This config is derived from the select schema, which cannot say which
     * columns have a database default — a generated primary key looks exactly
     * like a required one. Claiming `false` would make drizzle demand every
     * column on a raw `db.insert(table).values(...)`, including the ones the
     * database fills in.
     *
     * Nothing is lost by it: what actually validates an insert is the entity's
     * own `insertSchema`, applied in `Repository.cast()`. This only affects
     * raw drizzle inserts, which were equally permissive before the columns
     * carried their types at all.
     */
    hasDefault: true;
    isPrimaryKey: false;
    isAutoincrement: false;
    hasRuntimeDefault: false;
    enumValues: undefined;
    generated: undefined;
    identity: undefined;
  }
>;

export type SchemaToTableConfig<T extends ZObject> = {
  name: string;
  schema: string | undefined;
  columns: {
    [key in keyof Infer<T> & string]: SchemaToColumn<
      key,
      string,
      Infer<T>[key]
    >;
  };
  dialect: string;
};
