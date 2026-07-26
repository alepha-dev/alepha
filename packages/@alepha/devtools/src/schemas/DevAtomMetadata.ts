import { type Static, z } from "alepha";

export const devAtomMetadataSchema = z.object({
  /**
   * The unique name/key of the atom
   */
  name: z.text(),
  /**
   * Optional description of the atom
   */
  description: z.text().optional(),
  /**
   * The schema for the atom value (TypeBox/JSON Schema)
   */
  schema: z.any(),
  /**
   * The default value defined for the atom
   */
  defaultValue: z.any().optional(),
  /**
   * The current value of the atom
   */
  currentValue: z.any().optional(),
  /**
   * True when the atom was declared with `serverOnly: true`. Its value must
   * never reach a browser, so `defaultValue`/`currentValue` are omitted for
   * these atoms — only the atom's existence, name, description, and schema
   * are exposed.
   */
  serverOnly: z.boolean().optional(),
  /**
   * Persistence adapter (`cookie`, `localStorage`, `sessionStorage`) when the
   * atom declares one.
   *
   * Mutually exclusive with `serverOnly` — `$atom()` throws when both are
   * given, because every adapter targets the browser by definition. Together
   * the two fields say whether a value reaches the client and by which route.
   */
  persist: z.text().optional(),
});

export type DevAtomMetadata = Static<typeof devAtomMetadataSchema>;
