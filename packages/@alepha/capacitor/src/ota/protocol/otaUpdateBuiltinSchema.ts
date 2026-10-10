import { type Infer, z } from "alepha";

/**
 * An update check's answer when the device should go back to the web layer
 * built into its binary, HTTP 200: what the server says when the bundle a
 * device runs or holds was killed and no compatible bundle is left to fall
 * back on. `version: "builtin"` is the pinned updater's own name for it.
 */
export const otaUpdateBuiltinSchema = z.object({
  version: z.literal("builtin"),
  message: z.text().optional(),
});

export type OtaUpdateBuiltin = Infer<typeof otaUpdateBuiltinSchema>;
