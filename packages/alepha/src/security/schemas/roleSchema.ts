import type { Static } from "alepha";
import { z } from "alepha";

export const roleSchema = z.object({
  name: z.text({
    description: "Name of the role.",
  }),

  description: z
    .text({
      description: "Describe the role.",
    })
    .optional(),

  default: z
    .boolean()
    .describe("If true, this role will be assigned to all users by default.")
    .optional(),

  permissions: z.array(
    z.object({
      name: z.text({
        description: "Name of the permission.",
      }),
      ownership: z
        .boolean()
        .describe("If true, user will only have access to it's own resources.")
        .optional(),
      exclude: z
        .array(z.text())
        .describe("Exclude some permissions. Useful when 'name' is a wildcard.")
        .optional(),
    }),
  ),
});

export type Role = Static<typeof roleSchema>;
