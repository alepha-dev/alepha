import type { Infer } from "alepha";
import { z } from "alepha";

import { userCredentialSchema } from "./userCredentialSchema.ts";

/**
 * The `ownership` field as it is read. A decode reads it wherever it sits,
 * the non-enumerable property a permission check writes included, so the
 * field below does not let `false` through: it would turn any decoded copy
 * of a checked user into a privileged identity.
 */
const ownershipSchema = z
  .union([z.text(), z.boolean()])
  .describe(
    "Whether the caller is scoped to their own resources for the checked " +
      "permission. `false` is a privileged identity (admin); `true` or a " +
      "scope string narrows access to owned rows; `undefined` means no " +
      "permission check determined a scope. `false` does not survive this " +
      "schema: it is read on the user object a permission check produced, " +
      "or on an identity built by hand, never on a decoded copy.",
  );

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

  // Typed as the union it reads. The transform only ever removes `false`.
  ownership: (
    ownershipSchema.transform((ownership) =>
      ownership === false ? undefined : ownership,
    ) as unknown as typeof ownershipSchema
  ).optional(),
});

export type UserAccount = Infer<typeof userAccountInfoSchema>;
