import { $atom, z } from "alepha";

export const currentOrganizationRankAtom = $atom({
  name: "alepha.organizations.currentRank",
  schema: z
    .object({
      organizationId: z.uuid(),
      key: z.text().optional(),
      name: z.text().optional(),
      permissions: z.array(z.text()),
    })
    .optional(),
  serverOnly: true,
});
