import { $atom, type Infer, z } from "alepha";

/**
 * What `alepha.config.ts` says about this project's Lore.
 *
 * Config carries the project, env carries the secret. The same division
 * `alepha/cli/vendor` already uses, and the reason no credential ever lands in
 * a committed file: a project slug is public (it is in every URL Lore serves),
 * a key is not.
 */
export const loreOptions = $atom({
  name: "alepha.lore.cli.options",
  description: "Which Lore project this repository reports into",
  schema: z
    .object({
      /**
       * The project slug, as it appears in Lore's own URLs. Overridable per
       * invocation with `--project`.
       */
      project: z.text().optional(),
    })
    .optional(),
  serverOnly: true,
});

export type LoreOptions = Infer<typeof loreOptions.schema>;
