import { $atom, type Infer, z } from "alepha";

/**
 * Dev options atom for CLI dev command.
 *
 * Defines the available dev configuration options with their defaults.
 * Options can be overridden via alepha.config.ts or CLI flags.
 */
export const devOptions = $atom({
  name: "alepha.cli.dev.options",
  description: "Dev configuration options",
  schema: z.object({
    /**
     * Disable Vite React plugin.
     */
    noViteReactPlugin: z.boolean().default(false).optional(),
  }),
  default: {},
  serverOnly: true,
});

/**
 * Type for dev options.
 */
export type DevOptions = Infer<typeof devOptions.schema>;
