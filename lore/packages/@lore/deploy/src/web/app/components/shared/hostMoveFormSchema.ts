import { z } from "alepha";

/**
 * The project an estate moves to (#Q3280): the one field of the console's
 * Move dialog. A text because a select's value is one.
 */
export const estateMoveFormSchema = z.object({
  projectId: z.text({ maxLength: 20 }),
});
