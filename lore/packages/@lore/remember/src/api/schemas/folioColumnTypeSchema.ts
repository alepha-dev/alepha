import { type Infer, z } from "alepha";

/**
 * The six column types of a table folio (#E144).
 */
export const folioColumnTypeSchema = z.enum([
  "text",
  "number",
  "checkbox",
  "date",
  "select",
  "reference",
]);

export type FolioColumnType = Infer<typeof folioColumnTypeSchema>;
