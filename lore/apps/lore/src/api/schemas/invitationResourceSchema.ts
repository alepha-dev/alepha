import type { Infer } from "alepha";

import { invitations } from "../entities/invitations.ts";

export const invitationResourceSchema = invitations.schema;

export type InvitationResource = Infer<typeof invitationResourceSchema>;
