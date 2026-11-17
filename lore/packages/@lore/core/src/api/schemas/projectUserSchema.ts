import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";

/**
 * A project member as the project's own surfaces name them: the public card.
 *
 * Picked from the `users` entity rather than restated. `email` is the one
 * field a caller may not get: it is returned only to a caller holding
 * `member:read`, and every other field here is the card a rank without it
 * sees for each member.
 * Roles, login stamps and the rest of the account never leave the server
 * through this schema.
 */
export const projectUserSchema = users.schema
  .pick({
    id: true,
    username: true,
    firstName: true,
    lastName: true,
    picture: true,
    email: true,
  })
  .extend({
    /**
     * Whether a quest can be handed to them: their rank grants
     * `quest:update` (#Q3648). The assignee picker lists only these, and a
     * Viewer is not one of them.
     */
    assignable: z.boolean().optional(),
    /**
     * The name of their rank in this project, as the project calls it
     * (#Q3829): what a person's hover card says beside their name. Every
     * reader gets it, a rank of reads included: everyone in a project is
     * invited.
     */
    rank: z.text().optional(),
  });

export type ProjectUserResource = Infer<typeof projectUserSchema>;
