import { z } from "alepha";

export const automationPreviewSubjectFormSchema = z
  .object({ subject: z.string().max(255).optional() })
  .strict();
