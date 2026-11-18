import { z } from "alepha";

/**
 * The editor's header (#Q3811, the outline's since #Q3848): the
 * automation's title.
 */
export const automationEditorHeaderSchema = z.object({
  title: z.string().min(1).max(255),
});
