import { type Static, t } from "alepha";
import { $atom } from "../../core/primitives/$atom.ts";

/**
 * Dev options atom for CLI dev command.
 *
 * Defines the available dev configuration options with their defaults.
 * Options can be overridden via alepha.config.ts or CLI flags.
 */
export const devOptions = $atom({
  name: "alepha.cli.dev.options",
  description: "Dev configuration options",
  schema: t.object({
    /**
     * Disable devtools.
     */
    noDevtools: t.optional(t.boolean({ default: false })),

    /**
     * Disable Vite React plugin.
     */
    noViteReactPlugin: t.optional(t.boolean({ default: false })),
  }),
  default: {},
});

/**
 * Type for dev options.
 */
export type DevOptions = Static<typeof devOptions.schema>;
