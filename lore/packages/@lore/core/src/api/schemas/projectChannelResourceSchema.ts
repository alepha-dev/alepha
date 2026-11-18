import { type Infer, z } from "alepha";

/**
 * A channel as every reader sees it (#Q3614): never its URL.
 */
export const projectChannelResourceSchema = z
  .object({
    id: z.string().max(64),
    kind: z.string().max(32),
    name: z.string().max(64),
    builtIn: z.boolean(),
  })
  .strict();
export type ProjectChannelResource = Infer<typeof projectChannelResourceSchema>;
