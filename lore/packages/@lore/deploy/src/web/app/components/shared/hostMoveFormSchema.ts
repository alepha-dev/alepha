import { z } from "alepha";

/**
 * The project a host moves to (#Q3280): the one field of the console's
 * Move dialog. A text because a select's value is one.
 */
export const hostMoveFormSchema = z.object({
  projectId: z.text({ maxLength: 20 }),
});
