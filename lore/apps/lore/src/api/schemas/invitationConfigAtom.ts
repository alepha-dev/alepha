import { $atom, t } from "alepha";

export const invitationConfigAtom = $atom({
  name: "alepha.api.invitations.config",
  schema: t.object({
    expirationDays: t.integer({ minimum: 1, maximum: 90 }),
    maxPendingPerResource: t.integer({ minimum: 1, maximum: 500 }),
    maxPendingPerInviter: t.integer({
      minimum: 1,
      maximum: 1000,
    }),
    purgeDays: t.integer({ minimum: 0, maximum: 365 }),
  }),
  default: {
    expirationDays: 7,
    maxPendingPerResource: 50,
    maxPendingPerInviter: 100,
    purgeDays: 90,
  },
});
