import { type Infer, z } from "alepha";

/**
 * A channel as every reader sees it (#Q3614): never a Discord URL, which is
 * the whole credential. A webhook channel (#Q3900) shows its URL to whoever
 * manages notifications, since its secret is the signing key, plus its
 * endpoint's state: `disabled` when the framework switched it off.
 */
export const projectChannelResourceSchema = z
  .object({
    id: z.string().max(64),
    kind: z.string().max(32),
    name: z.string().max(64),
    builtIn: z.boolean(),
    url: z.string().max(2048).optional(),
    status: z.enum(["active", "paused", "disabled"]).optional(),
    disabledReason: z.string().max(32).optional(),
    secretPrefix: z.string().max(10).optional(),
  })
  .strict();
export type ProjectChannelResource = Infer<typeof projectChannelResourceSchema>;
