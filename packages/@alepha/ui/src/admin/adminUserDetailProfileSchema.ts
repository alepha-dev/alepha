import { type Infer, z } from "alepha";

/**
 * Editable profile fields on the admin user detail page.
 *
 * `username` and `email` are optional here on purpose: `useForm` decodes the
 * schema on first mount, before the user has loaded, and required fields
 * would fail that empty decode. The page's submit handler enforces them.
 */
export const profileSchema = z.object({
  username: z.string().optional(),
  email: z.string().optional(),
  emailVerified: z.boolean().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  roles: z.array(z.string()).optional(),
});

export type ProfileForm = Infer<typeof profileSchema>;
