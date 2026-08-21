import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { invitationQuerySchema } from "../schemas/invitationQuerySchema.ts";
import { invitationResourceSchema } from "../schemas/invitationResourceSchema.ts";
import { InvitationService } from "../services/InvitationService.ts";

export class AdminInvitationController {
  protected readonly url = "/invitations";
  protected readonly group = "admin:invitations";
  protected readonly invitationService = $inject(InvitationService);

  /**
   * Find invitations with pagination and filtering.
   */
  public readonly findInvitations = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:invitation:read"] })],
    description: "Find invitations with pagination and filtering",
    schema: {
      query: invitationQuerySchema,
      response: z.page(invitationResourceSchema),
    },
    handler: ({ query }) => this.invitationService.findInvitations(query),
  });

  /**
   * Get an invitation by ID.
   */
  public readonly getInvitation = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:invitation:read"] })],
    description: "Get an invitation by ID",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: invitationResourceSchema,
    },
    handler: ({ params }) => this.invitationService.getById(params.id),
  });

  /**
   * Revoke a pending invitation.
   */
  public readonly revokeInvitation = $action({
    method: "POST",
    path: `${this.url}/:id/revoke`,
    group: this.group,
    use: [$secure({ permissions: ["admin:invitation:delete"] })],
    description: "Revoke a pending invitation",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.invitationService.revoke(params.id, { id: user.id });
      return { ok: true };
    },
  });

  /**
   * Delete an invitation.
   */
  public readonly deleteInvitation = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:invitation:delete"] })],
    description: "Delete an invitation",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.invitationService.deleteInvitation(params.id);
      return { ok: true, id: params.id };
    },
  });
}
