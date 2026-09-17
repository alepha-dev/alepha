import { $atom, z } from "alepha";

export const organizationConfigAtom = $atom({
  name: "alepha.api.organizations.config",
  schema: z.object({
    memberPermissions: z.array(z.string()),
    floor: z.array(z.string()),
    ownerOnly: z.array(z.string()),
  }),
  default: {
    memberPermissions: [],
    floor: [],
    ownerOnly: ["organization:delete"],
  },
  serverOnly: true,
});
