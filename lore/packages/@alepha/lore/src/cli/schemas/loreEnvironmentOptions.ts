import { type Infer, z } from "alepha";

/**
 * What `lore()` takes in `alepha.config.ts`.
 *
 * No `app` and no `env`: they are `infra().name` and the environment's key.
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
   * Refused (#Q3144): which machine a copy deploys to is set in Lore, where
   * the host is lent, never in `alepha.config.ts`. It was read only when a
   * first `up` created the copy, so on an existing copy it was dead config
   * that looked authoritative. Kept in the schema only to say so.
   */
  host: z
    .undefined({
      error:
        "lore() takes no host: set it in Lore, on the copy's Settings tab or with `lore apps instance create --host <slug>`, and remove `host` from alepha.config.ts.",
    })
    .optional(),
  /**
   * Deploy the app into this stack (#Q2703): `lore({ stack: "hello" })` and
   * `alepha deploy staging` put the app into `hello/staging`, redeploying
   * only its service. The host is the stack environment's.
   */
  stack: z.text().optional(),
});

export type LoreEnvironmentOptions = Infer<typeof loreEnvironmentOptionsSchema>;
