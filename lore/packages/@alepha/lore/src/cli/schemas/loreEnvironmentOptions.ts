import { type Infer, z } from "alepha";

/**
 * What `lore()` takes in `alepha.config.ts`.
 *
 * No `app` and no `env`: they are `platform().name` and the environment's key.
 * No `sigil`: Lore mints one from the manifest's lore-client variables.
 */
export const loreEnvironmentOptionsSchema = z.object({
  /**
   * The Lore project slug. `LORE_PROJECT` overrides, and `lore()` with no
   * arguments is legal when it is set, which is the CI case.
   */
  project: z.text().optional(),
  /**
   * Origin of the Lore instance. Defaults to `https://lore.alepha.dev`, and
   * `LORE_URL` overrides.
   */
  url: z.text().optional(),
  /**
   * The estate a copy created by the first `up` deploys to, by slug. Only read
   * when the copy does not exist yet; omitted, it is the estate lent to the
   * project first. An existing copy keeps the estate it has.
   */
  estate: z.text().optional(),
});

export type LoreEnvironmentOptions = Infer<typeof loreEnvironmentOptionsSchema>;
