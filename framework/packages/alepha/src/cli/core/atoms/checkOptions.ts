import { $atom, type Infer, z } from "alepha";

/**
 * Options for `alepha check`, the convention rules run over an app's own
 * source.
 *
 * Set from the `check` key of `alepha.config.ts`. `check: false` there sets
 * `enabled` to `false`, which removes the step from `alepha verify` and
 * nothing else: `alepha check` typed by hand still runs.
 *
 * ⚠️ Rule ids are not validated here. The config is parsed when the module is
 * evaluated, long before the registry exists, so an unknown id in `rules` is
 * refused by `ConventionRunner` when it reads this atom, with the list of the
 * valid ones.
 */
export const checkOptions = $atom({
  name: "alepha.cli.check.options",
  description: "Convention rules run by alepha check",
  schema: z.object({
    /**
     * Whether `alepha verify` runs `alepha check`. Written by `check: false`
     * in the config, never set by hand.
     */
    enabled: z.boolean().optional(),

    /**
     * Turn a rule `off` (or back `on`) by its id. Every rule is on by default.
     *
     * @example rules: { "no-module-code": "off" }
     */
    rules: z.record(z.string(), z.enum(["on", "off"])).optional(),

    /**
     * Paths hidden from every rule, as globs relative to the app root, read
     * with the same matcher as the root `.gitignore`. There is no per-rule
     * path scope: exempt a line with a reason instead.
     *
     * @example ignore: ["src/legacy/**"]
     */
    ignore: z.array(z.string()).optional(),
  }),
  default: {},
  serverOnly: true,
});

/**
 * Type for check options.
 */
export type CheckOptions = Infer<typeof checkOptions.schema>;
