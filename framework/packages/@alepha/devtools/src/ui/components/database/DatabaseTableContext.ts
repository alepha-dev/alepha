import { AlephaError } from "alepha";
import { createContext, useContext } from "react";

export interface DatabaseTableContextValue {
  /**
   * The open table's entity, as the metadata describes it.
   */
  entity: any;
  /**
   * The primary key column's name.
   */
  pk: string;
  /**
   * The page of rows the grid holds. A record page reads its row out of
   * this, so opening a row costs no request.
   */
  records: any[];
  /**
   * Creates (`POST`) or updates (`PUT` with `id`) a row and reloads the
   * grid. Returns an error message, or `null` on success.
   */
  write: (
    method: "POST" | "PUT",
    values: any,
    id?: string,
  ) => Promise<string | null>;
  /**
   * Deletes rows after a confirmation, then returns to the table.
   */
  removeIds: (ids: string[]) => Promise<void>;
}

// Context exemption: the grid a `/rows/:table` page loads is what its own
// `/rows/:table/:id` child edits, and only that child. An atom holds one value
// per Alepha container, which says nothing about which table's page is the
// parent of this record; the subtree does.
export const DatabaseTableContext =
  createContext<DatabaseTableContextValue | null>(null);

/**
 * The grid of the table page this record page is nested in.
 */
export const useDatabaseTable = (): DatabaseTableContextValue => {
  const value = useContext(DatabaseTableContext);
  if (!value) {
    throw new AlephaError(
      "useDatabaseTable() must be called under a /rows/:table page",
    );
  }
  return value;
};
