import type { Infer } from "alepha";
import { z } from "alepha";

import { userCredentialSchema } from "./userCredentialSchema.ts";

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

  permissionScope: z
    .array(z.text())
    .describe(
      "Caps what this credential may do, below what its roles grant. " +
        "`undefined` is unrestricted; an entry is a permission or a pattern " +
        "(`group:*`, `*`) and a permission must match one; `[]` matches " +
        "nothing, so every permission-checked route refuses. It binds " +
        "permission checks only: a route that declares no permission still " +
        "admits a scoped credential.",
    )
    .optional(),

  credential: userCredentialSchema
    .describe(
      "The machine credential this identity was authenticated by (an API " +
        "key, or a connected app's OAuth access token). Absent on a " +
        "signed-in session. A route declaring " +
        "`$secure({ sessionOnly: true })` refuses any identity carrying one.",
    )
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
