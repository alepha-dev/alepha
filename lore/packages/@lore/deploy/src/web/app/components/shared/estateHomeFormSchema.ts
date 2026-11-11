import { z } from "alepha";

/**
 * The project a new estate is created in, its home (#E126): the one field
 * the account page's Add dialog asks for beside `estateCreateFormSchema`.
 * A text because a select's value is one; the dialog turns it back into the
 * project id.
 */
export const estateHomeFormSchema = z.object({
  projectId: z.text({ maxLength: 20 }),
});
