import { type Infer, z } from "alepha";

/**
 * One capability as `lore project capability list` reads it (#Q3141): every
 * key the registry declares, whether this project has it on, and each of its
 * options with its current value. Read from `CapabilityRegistry` on the
 * server, so no client keeps a hand-written list of keys.
 */
export const projectCapabilityStateSchema = z.object({
  key: z.text(),
  name: z.text(),
  enabled: z.boolean(),
  options: z.array(z.object({ key: z.text(), enabled: z.boolean() })),
});

export type ProjectCapabilityState = Infer<typeof projectCapabilityStateSchema>;
