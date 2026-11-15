import { type Infer } from "alepha";
import { users } from "alepha/api/users";

/**
 * A project member as the project's own surfaces name them: the public card.
 *
 * Picked from the `users` entity rather than restated. `email` is the one
 * field a caller may not get: it is returned only to a caller holding
 * `member:read`, and every other field here is the card a viewer of an open
 * project sees for each member (folio "Open projects: safety contract").
 * Roles, login stamps and the rest of the account never leave the server
 * through this schema.
 */
export const projectUserSchema = users.schema.pick({
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  picture: true,
  email: true,
});

export type ProjectUserResource = Infer<typeof projectUserSchema>;
