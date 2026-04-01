import { $atom, type Static, t } from "alepha";

/**
 * Devtools configuration atom.
 *
 * Filled from the `devtools` section of `alepha.config.ts`.
 */
export const devtoolsOptions = $atom({
  name: "alepha.cli.devtools.options",
  description: "Devtools plugin configuration",
  schema: t.optional(
    t.object({
      /**
       * Hide the floating devtools button in the browser.
       *
       * The devtools UI is still accessible at `/__devtools/`.
       */
      hideButton: t.optional(t.boolean({ default: false })),
    }),
  ),
});

/**
 * Type for devtools options.
 */
export type DevtoolsOptions = Static<typeof devtoolsOptions.schema>;
