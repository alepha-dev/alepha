import { type Infer, z } from "alepha";

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
   * The atom value's shape as JSON Schema.
   *
   * ⚠️ `.optional()` is load-bearing, and dropping it took the whole devtools
   * UI down once. Not every schema HAS a JSON Schema representation:
   * `z.toJSONSchema()` throws "Custom types cannot be represented in JSON
   * Schema" on a `z.custom()`, and `DevToolsMetadataProvider.toJsonSchema`
   * answers `undefined` — which is the honest answer, not a failure.
   *
   * Required, the field then failed in a way that pointed nowhere near the
   * cause: `z.any()` ACCEPTS a present-but-undefined key, so the response
   * validated server-side and answered 200; `JSON.stringify` then dropped the
   * key, and the client rejected the same payload with "expected nonoptional".
   * Every panel reading this one document broke at once — the reported symptom
   * was "Couldn't load actions", from an atom two panels away.
   *
   * `@alepha/ui`'s `adminRouterOptionsAtom` and `accountRouterOptionsAtom` are
   * both `z.custom()` (they carry React nodes), so mounting either router was
   * enough to trigger it. See `DevEnvMetadata.schema`, which is the same field
   * fed by the same helper.
   */
  schema: z.any().optional(),
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

export type DevAtomMetadata = Infer<typeof devAtomMetadataSchema>;
