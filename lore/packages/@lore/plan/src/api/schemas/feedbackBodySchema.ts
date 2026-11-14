import { z } from "alepha";

import { feedbackSourceSchema } from "./feedbackSourceSchema.ts";

/**
 * What a reporter may submit: the two required fields plus the optional
 * attachment ids, tags, and the embedded-submission provenance.
 */
export const feedbackBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  attachments: z.array(z.uuid()).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  /**
   * Provenance of an embedded submission. Absent for first-party feedback.
   * The fields are attacker-controlled (set by the embedding page) — they
   * are persisted verbatim and must only ever be rendered as escaped plain
   * text. See `feedback.source` + folio #12.
   */
  source: feedbackSourceSchema.optional(),
});
