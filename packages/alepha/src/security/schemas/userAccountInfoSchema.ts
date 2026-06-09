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

  firstName: t.optional(
    t.text({
      description: "Given name of the user (OIDC `given_name`).",
    }),
  ),

  lastName: t.optional(
    t.text({
      description: "Family name of the user (OIDC `family_name`).",
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

  organization: t.optional(
    t.uuid({
      description: "Organization the user belongs to.",
    }),
  ),

  roles: t.optional(
    t.array(t.text(), {
      description: "List of roles assigned to the user.",
    }),
  ),

  realm: t.optional(
    t.text({
      description: "The realm (issuer) the user was authenticated from.",
    }),
  ),
});

export type UserAccount = Static<typeof userAccountInfoSchema>;
