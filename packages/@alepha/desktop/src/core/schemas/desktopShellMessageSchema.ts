import { type Infer, z } from "alepha";

/**
 * What the desktop shell sends to the Worker hosting the app (protocol 1).
 *
 * - `init`, once: the environment the app is created with, the window's
 *   identity, and the one-use launch capability the admission guard accepts
 *   on `/__alepha_desktop/bootstrap`;
 * - `stop`, once: run the app's stop hooks, then answer `stopped`.
 *
 * Plain `z.string()`, not `z.text()`: an environment value or a path can be
 * longer than 255 characters.
 */
export const desktopShellMessageSchema = z.union([
  z.object({
    type: z.literal("init"),
    version: z.literal(1),
    name: z.string().min(1),
    identifier: z.string().min(1),
    env: z.record(z.string(), z.string()),
    capability: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({
    type: z.literal("stop"),
  }),
]);

export type DesktopShellMessage = Infer<typeof desktopShellMessageSchema>;
