import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { organizationInvitations } from "../entities/organizationInvitations.ts";
import { InvitationService } from "../services/InvitationService.ts";

export class AdminOrganizationInvitationController {
  protected readonly invitations = $inject(InvitationService);

  public readonly getAdminOrganizationInvitations = $action({
    path: "/admin/organization-invitations",
    use: [$secure({ permissions: ["admin:invitation:read"] })],
    schema: { response: z.array(organizationInvitations.schema) },
    handler: () => this.invitations.findAll(),
  });

  public readonly getAdminOrganizationInvitation = $action({
    path: "/admin/organization-invitations/:invitationId",
    use: [$secure({ permissions: ["admin:invitation:read"] })],
    schema: {
      params: z.object({ invitationId: z.uuid() }),
      response: organizationInvitations.schema,
    },
    handler: ({ params }) => this.invitations.getById(params.invitationId),
  });

  public readonly revokeAdminOrganizationInvitation = $action({
    method: "POST",
    path: "/admin/organization-invitations/:invitationId/revoke",
    use: [$secure({ permissions: ["admin:invitation:delete"] })],
    schema: {
      params: z.object({ invitationId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.invitations.revoke(params.invitationId, user);
      return { ok: true };
    },
  });

  public readonly deleteAdminOrganizationInvitation = $action({
    method: "DELETE",
    path: "/admin/organization-invitations/:invitationId",
    use: [$secure({ permissions: ["admin:invitation:delete"] })],
    schema: {
      params: z.object({ invitationId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.invitations.delete(params.invitationId);
      return { ok: true };
    },
  });
}
