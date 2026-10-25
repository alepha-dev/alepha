import { type Infer, z } from "alepha";

/**
 * The top-level `desktop` object of `alepha.config.ts`: what the window and
 * the `.app` are called, and how the window opens.
 *
 * - `name`: the display name, also the bundle's file name (`<name>.app`), so
 *   it is one safe path component: letters, digits, spaces, `.`, `_` and `-`,
 *   not starting with a dot;
 * - `identifier`: reverse-DNS, e.g. `dev.alepha.loom`. It names the per-user
 *   data and log folders and the instance lock, so changing it orphans the
 *   data written under the old one;
 * - `icon`: a PNG, relative to the project root. A default icon ships with
 *   the package;
 * - `window`: `title` (default: `name`), `width` (1200), `height` (800) and
 *   `resizable` (true).
 */
export const desktopConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/, {
      message:
        "use letters, digits, spaces, '.', '_' and '-', starting with a letter or a digit",
    })
    .refine((name) => !name.endsWith(" ") && !name.includes(".."), {
      message: "must not end with a space or contain '..'",
    }),
  identifier: z
    .string()
    .max(155)
    .regex(/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/, {
      message: "must be reverse-DNS, e.g. dev.alepha.loom",
    }),
  icon: z.string().min(1).optional(),
  window: z
    .object({
      title: z.string().min(1).max(200).optional(),
      width: z.number().int().positive().max(16384).optional(),
      height: z.number().int().positive().max(16384).optional(),
      resizable: z.boolean().optional(),
    })
    .optional(),
});

export type DesktopConfig = Infer<typeof desktopConfigSchema>;
