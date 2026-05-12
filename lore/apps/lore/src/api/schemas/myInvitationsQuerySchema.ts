import type { Static } from "alepha";
import { t } from "alepha";

export const myInvitationsQuerySchema = t.object({
  status: t.optional(
    t.enum(["pending", "accepted", "declined", "expired", "revoked"]),
  ),
});

export type MyInvitationsQuery = Static<typeof myInvitationsQuerySchema>;
