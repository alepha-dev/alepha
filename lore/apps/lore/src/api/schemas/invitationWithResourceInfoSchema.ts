import type { Static } from "alepha";
import { t } from "alepha";

export const invitationWithResourceInfoSchema = t.object({
  id: t.uuid(),
  email: t.string({ format: "email" }),
  resourceType: t.text(),
  resourceId: t.text(),
  resourceName: t.text(),
  resourceUrl: t.optional(t.text()),
  invitedBy: t.uuid(),
  inviterName: t.optional(t.text()),
  inviterEmail: t.optional(t.string({ format: "email" })),
  roles: t.optional(t.array(t.text())),
  status: t.enum(["pending", "accepted", "declined", "expired", "revoked"]),
  createdAt: t.datetime(),
  expiresAt: t.datetime(),
});

export type InvitationWithResourceInfo = Static<
  typeof invitationWithResourceInfoSchema
>;
