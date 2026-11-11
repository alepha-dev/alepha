import { z } from "alepha";

/**
 * The one field of the admin's Assign dialog: the project an estate gets as
 * its home (#Q3280, #Q3281). A text because a select's value is one.
 */
export const adminEstateAssignFormSchema = z.object({
  projectId: z.text({ maxLength: 20 }),
});
