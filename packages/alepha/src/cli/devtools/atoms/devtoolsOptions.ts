import { $atom, type Static, z } from "alepha";

/**
 * Devtools configuration atom.
 *
 * Filled from the `devtools` section of `alepha.config.ts`.
 */
export const devtoolsOptions = $atom({
  name: "alepha.cli.devtools.options",
  description: "Devtools plugin configuration",
  schema: z
    .object({
      /**
       * Hide the floating devtools button in the browser.
       *
       * The devtools UI is still accessible at `/__devtools/`.
       */
      hideButton: z.boolean().default(false).optional(),
    })
    .optional(),
  serverOnly: true,
});

/**
 * Type for devtools options.
 */
export type DevtoolsOptions = Static<typeof devtoolsOptions.schema>;
