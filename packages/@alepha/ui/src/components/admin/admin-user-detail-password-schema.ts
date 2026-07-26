import { z } from "alepha";

/**
 * Body of the admin "set password" form.
 *
 * Lives in its own file so the dialog and the page shell that owns the form
 * model agree on the shape without either importing the other.
 */
export const passwordSchema = z.object({
  password: z.string().min(6),
});
