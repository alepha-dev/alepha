import { type Infer, z } from "alepha";

/**
 * One file of a run's evidence (#E153): a screenshot or a recording in the
 * `use-case-evidence` bucket, placed on a criterion or a step when known.
 * `removedAt` is set when retention deleted the file and kept the run.
 */
export const runEvidenceSchema = z.object({
  fileId: z.uuid(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  criterionKey: z.string().optional(),
  step: z.integer().optional(),
  removedAt: z.datetime().optional(),
});

export type RunEvidence = Infer<typeof runEvidenceSchema>;
