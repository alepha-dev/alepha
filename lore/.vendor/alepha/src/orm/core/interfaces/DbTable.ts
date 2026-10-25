import type { Infer, ZObject } from "alepha";

/**
 * A reference to one column of a table, typed by the value it holds.
 *
 * Interpolated in a `sql` template it renders the qualified column name, and
 * a where-filter takes it as an operand to compare two columns
 * (`{ epicId: { eq: epics.table.id } }`). It is opaque: the drizzle column
 * behind it is reached through `alepha/orm/drizzle`, outside semver.
 */
export interface DbColumn<TValue = unknown> {
  readonly "~dbColumn": TValue;

  /**
   * The column's physical name, for the places SQL wants it unqualified:
   * `` sql`UPDATE ${t} SET ${sql.identifier(t.rank.name)} = ...` ``.
   */
  readonly name: string;
}

/**
 * A reference to a table, with one {@link DbColumn} per field.
 *
 * Interpolated in a `sql` template it renders the qualified table name:
 * `` sql`SELECT * FROM ${repo.table} WHERE ${repo.table.age} > ${18}` ``.
 */
export type DbTable<T extends ZObject> = {
  readonly [K in keyof Infer<T>]-?: DbColumn<Infer<T>[K]>;
} & {
  readonly "~dbTable": true;
};
