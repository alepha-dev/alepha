import { type Static, t } from "alepha";

export const devAtomMetadataSchema = t.object({
  /**
   * The unique name/key of the atom
   */
  name: t.text(),
  /**
   * Optional description of the atom
   */
  description: t.optional(t.text()),
  /**
   * The schema for the atom value (TypeBox/JSON Schema)
   */
  schema: t.any(),
  /**
   * The default value defined for the atom
   */
  defaultValue: t.optional(t.any()),
  /**
   * The current value of the atom
   */
  currentValue: t.optional(t.any()),
});

export type DevAtomMetadata = Static<typeof devAtomMetadataSchema>;
