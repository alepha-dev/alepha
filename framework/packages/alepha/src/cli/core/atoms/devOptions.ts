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

    /**
     * Port the dev server binds to.
     *
     * Ranks below `SERVER_PORT`, so CI and one-off overrides still win, and
     * above Vite's own `server.port`. Set it when a repository runs more than
     * one app: every app otherwise defaults to 5173, and because the port is
     * bound with `strictPort`, the second one now fails loudly instead of
     * drifting to 5174 under a URL that nothing reports.
     */
    port: z.integer().optional(),
  }),
  default: {},
  serverOnly: true,
});

/**
 * Type for dev options.
 */
export type DevOptions = Infer<typeof devOptions.schema>;
