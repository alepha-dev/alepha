import { z } from "alepha";

export const automationPreviewSubjectFormSchema = z
  .object({
    subject: z.string().max(255).optional(),
    /**
     * The source to start from (#Q3807), when there are several.
     */
    node: z.string().max(64).optional(),
  })
  .strict();
