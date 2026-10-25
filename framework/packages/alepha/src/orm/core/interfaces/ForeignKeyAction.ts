/**
 * What a foreign key does to the referencing rows when the referenced row is
 * updated or deleted.
 */
export type ForeignKeyAction =
  | "cascade"
  | "restrict"
  | "no action"
  | "set null"
  | "set default";
