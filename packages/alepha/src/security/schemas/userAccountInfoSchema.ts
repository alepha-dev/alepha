import type { Static } from "alepha";
import { t } from "alepha";

export const userAccountInfoSchema = t.object({
  id: t.text({
    description: "Unique identifier for the user.",
  }),

  name: t.optional(
    t.text({
      description: "Full name of the user.",
    }),
  ),

  email: t.optional(
    t.text({
      description: "Email address of the user.",
      format: "email",
    }),
  ),

  username: t.optional(
    t.text({
      description: "Preferred username of the user.",
    }),
  ),

  picture: t.optional(
    t.text({
      description: "URL to the user's profile picture.",
    }),
  ),

  sessionId: t.optional(
    t.text({
      description: "Session identifier for the user, if applicable.",
    }),
  ),

  // -------------------------------------------------------------------------------------------------------------------

  organizations: t.optional(
    t.array(t.text(), {
      description: "List of organizations the user belongs to.",
    }),
  ),

  roles: t.optional(
    t.array(t.text(), {
      description: "List of roles assigned to the user.",
    }),
  ),
});

export type UserAccount = Static<typeof userAccountInfoSchema>;
