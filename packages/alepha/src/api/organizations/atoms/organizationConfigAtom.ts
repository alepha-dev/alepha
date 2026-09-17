import { $atom, z } from "alepha";

export const organizationConfigAtom = $atom({
  name: "alepha.api.organizations.config",
  schema: z.object({}),
  default: {},
  serverOnly: true,
});
