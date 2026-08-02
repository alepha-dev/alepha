import type { Infer } from "alepha";
import { z } from "alepha";

export const userAccountInfoSchema = z.object({
  id: z.text({
    description: "Unique identifier for the user.",
  }),

  name: z
    .text({
      description: "Full name of the user.",
    })
    .optional(),

  firstName: z
    .text({
      description: "Given name of the user (OIDC `given_name`).",
    })
    .optional(),

  lastName: z
    .text({
      description: "Family name of the user (OIDC `family_name`).",
    })
    .optional(),

  email: z
    .text({
      description: "Email address of the user.",
      format: "email",
    })
    .optional(),

  username: z
    .text({
      description: "Preferred username of the user.",
    })
    .optional(),

  picture: z
    .text({
      description: "URL to the user's profile picture.",
    })
    .optional(),

  sessionId: z
    .text({
      description: "Session identifier for the user, if applicable.",
    })
    .optional(),

  // -------------------------------------------------------------------------------------------------------------------

  organization: z
    .uuid()
    .describe("Organization the user belongs to.")
    .optional(),

  roles: z
    .array(z.text())
    .describe("List of roles assigned to the user.")
    .optional(),

  realm: z
    .text({
      description: "The realm (issuer) the user was authenticated from.",
    })
    .optional(),

  ownership: z
    .union([z.text(), z.boolean()])
    .describe(
      "Whether the caller is scoped to their own resources for the checked " +
        "permission. `false` is a privileged identity (admin); `true` or a " +
        "scope string narrows access to owned rows; `undefined` means no " +
        "permission check determined a scope.",
    )
    .optional(),
});

export type UserAccount = Infer<typeof userAccountInfoSchema>;
