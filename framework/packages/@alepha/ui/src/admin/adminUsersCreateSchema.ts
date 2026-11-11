import { type Infer, z } from "alepha";

/**
 * Fields of the admin "create user" dialog.
 *
 * Everything is optional here on purpose: which of `username` and `email` the
 * realm collects, and which it insists on, is only known once its config has
 * loaded, so the dialog's submit handler enforces them (see
 * `profilePolicy`). `password` is not part of the create body: when filled,
 * it is set with a second call.
 */
export const createUserFormSchema = z.object({
  email: z.string().optional(),
  username: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  password: z.string().optional(),
});

export type CreateUserForm = Infer<typeof createUserFormSchema>;
