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
   * True when the atom was declared with `serverOnly: true` — meaning the
   * *application* never serializes it into its SSR hydration payload.
   *
   * It does not redact anything here. Devtools is a server-side tool that
   * refuses to register in production and already serves the environment in
   * cleartext; withholding these values would hide exactly the state this
   * screen exists to show.
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
