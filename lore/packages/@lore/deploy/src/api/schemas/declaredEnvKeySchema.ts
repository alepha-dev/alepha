import { type Infer, z } from "alepha";

/**
 * One environment variable an app declares through `$env`, as its build's
 * `manifest.json` lists it (#Q2467).
 *
 * `kind` is which list it came from: `variable` for a key declared
 * `secret: false`, whose value Lore stores readable and shows, `secret` for
 * everything else. It is what the Environment tab autocompletes names from, and
 * what decides how a value is stored when it is set.
 */
export const declaredEnvKeySchema = z.object({
  name: z.string(),
  /**
   * The `$env` schema's own description, when it declared one.
   */
  description: z.string().optional(),
  kind: z.enum(["secret", "variable"]),
});

export type DeclaredEnvKey = Infer<typeof declaredEnvKeySchema>;
