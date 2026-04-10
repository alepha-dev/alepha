import { $atom, t } from "alepha";

export const issueConfigAtom = $atom({
  name: "alepha.api.issues.config",
  schema: t.object({
    enabled: t.boolean(),
    maxOpenPerUser: t.integer({ minimum: 1, maximum: 1000 }),
  }),
  default: {
    enabled: true,
    maxOpenPerUser: 50,
  },
});
