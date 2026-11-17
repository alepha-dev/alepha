import { z } from "alepha";

/**
 * The canvas editor's header (#Q3811): the automation's title.
 */
export const automationEditorHeaderSchema = z.object({
  title: z.string().min(1).max(255),
});
