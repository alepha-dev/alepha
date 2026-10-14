import { $atom, z } from "alepha";

/**
 * The top-level `desktop` object of `alepha.config.ts`, read by
 * `alepha compile --desktop` and nothing else.
 *
 * ```ts
 * export default defineConfig({
 *   build: { runtime: "bun" },
 *   desktop: {
 *     name: "Loom",
 *     identifier: "dev.alepha.loom",
 *     icon: "assets/icon.png",
 *     window: { width: 1280, height: 860 },
 *   },
 * });
 * ```
 *
 * - `name` (required): the display name and the bundle's file name,
 *   `dist/<name>.app`;
 * - `identifier` (required): reverse-DNS, names the per-user data and log
 *   folders, so changing it orphans what was written under the old one;
 * - `icon`: a PNG relative to the project root, converted to ICNS. The
 *   package's default icon otherwise;
 * - `window`: `title` (default `name`), `width` (1200), `height` (800),
 *   `resizable` (true).
 *
 * ## ⚠️ Opt-in by flag, never by config
 *
 * Declaring it changes nothing about `alepha build`, `alepha compile` or
 * `alepha image`: only `alepha compile --desktop` reads it. The shape is
 * checked loosely here and strictly by `@alepha/desktop`, which owns the
 * rules (a safe file name, reverse-DNS) and is the package that must be
 * installed for the flag to work at all.
 */
export const desktopOptions = $atom({
  name: "alepha.cli.desktop.options",
  description: "Native desktop window configuration",
  schema: z.object({
    name: z.string().optional(),
    identifier: z.string().optional(),
    icon: z.string().optional(),
    window: z
      .object({
        title: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        resizable: z.boolean().optional(),
      })
      .optional(),
  }),
  default: {},
  serverOnly: true,
});

/**
 * The `desktop` object of `alepha.config.ts`. See {@link desktopOptions}.
 */
export interface DesktopOptions {
  name: string;
  identifier: string;
  icon?: string;
  window?: {
    title?: string;
    width?: number;
    height?: number;
    resizable?: boolean;
  };
}
