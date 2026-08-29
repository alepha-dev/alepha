import { type Infer, z } from "alepha";

export const blightResourceSchema = z.object({
  id: z.integer(),
  /**
   * Which app reported it last.
   *
   * A blight is one row per project and per fingerprint, so a bug present in
   * two enrolled apps is one triage decision; this names the sigil
   * that most recently saw it, which is what the inbox's filter means. The
   * per-app breakdown lives in `sigil_error_groups`.
   */
  sigilId: z.uuid().optional(),
  fingerprint: z.string(),
  name: z.string(),
  message: z.string(),
  stack: z.string(),
  sourceUrl: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  count: z.integer(),
  status: z.string(),
  origin: z.enum(["client", "server"]),
});

export type BlightResource = Infer<typeof blightResourceSchema>;
