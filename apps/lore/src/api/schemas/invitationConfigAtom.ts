import { $atom, z } from "alepha";

export const invitationConfigAtom = $atom({
  name: "alepha.api.invitations.config",
  schema: z.object({
    expirationDays: z.integer().min(1).max(90),
    maxPendingPerResource: z.integer().min(1).max(500),
    maxPendingPerInviter: z.integer().min(1).max(1000),
    purgeDays: z.integer().min(0).max(365),
  }),
  default: {
    expirationDays: 7,
    maxPendingPerResource: 50,
    maxPendingPerInviter: 100,
    purgeDays: 90,
  },
  serverOnly: true,
});
