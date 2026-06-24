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
});

export type DevAtomMetadata = Static<typeof devAtomMetadataSchema>;
