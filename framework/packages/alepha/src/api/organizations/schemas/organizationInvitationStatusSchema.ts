import { z } from "alepha";

export const organizationInvitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "expired",
  "revoked",
]);
