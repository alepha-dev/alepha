import type { Static } from "alepha";
import { t } from "alepha";

export const createInvitationSchema = t.object({
  email: t.string({ format: "email" }),
  resourceType: t.text({ minLength: 1, maxLength: 100 }),
  resourceId: t.text({ minLength: 1, maxLength: 255 }),
  roles: t.optional(t.array(t.text())),
  metadata: t.optional(t.record(t.text(), t.any())),
});

export type CreateInvitation = Static<typeof createInvitationSchema>;
