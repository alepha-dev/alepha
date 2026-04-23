import type { Static } from "alepha";
import { invitations } from "../entities/invitations.ts";

export const invitationResourceSchema = invitations.schema;

export type InvitationResource = Static<typeof invitationResourceSchema>;
