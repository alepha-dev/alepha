import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { createInvitationSchema } from "../schemas/createInvitationSchema.ts";
import { invitationResourceSchema } from "../schemas/invitationResourceSchema.ts";
import { InvitationService } from "../services/InvitationService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

const inboxItemSchema = invitationResourceSchema.extend({
  projectTitle: z.string(),
  inviterName: z.string().optional(),
});

export class InvitationController {
  protected readonly url = "/invitations";
  protected readonly group = "invitations";
  protected readonly invitationService = $inject(InvitationService);
  protected readonly security = $inject(ProjectSecurityService);

  /**
   * Create a new invitation.
   */
  public readonly createInvitation = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["invitation:create"] })],
    description: "Create a new invitation",
    schema: {
      body: createInvitationSchema,
      response: invitationResourceSchema,
    },
    handler: ({ body, user }) => this.invitationService.create(body, user),
  });

  /**
   * Owner-scoped: list pending invitations for a project the caller
   * owns. Used by the settings page to render pending rows.
   */
  public readonly listProjectInvitations = $action({
    path: `${this.url}/project/:projectId`,
    group: this.group,
    use: [$secure({ permissions: ["project:read"] })],
    description: "List pending invitations for a project the caller owns",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.array(invitationResourceSchema),
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.projectId, user);
      return this.invitationService.findByResource(
        "project",
        String(params.projectId),
        "pending",
      );
    },
  });

  /**
   * Inbox: pending invitations addressed to the current user's email.
   * Rendered at /account/invitations.
   */
  public readonly listMyInvitations = $action({
    path: `${this.url}/me`,
    group: this.group,
    use: [$secure()],
    description: "List pending invitations addressed to the current user",
    schema: {
      response: z.array(inboxItemSchema),
    },
    handler: ({ user }) => this.invitationService.listForUser(user),
  });

  /**
   * Accept an invitation by id. The session's email must match the
   * invitation's email (case-insensitive) — that's the proof.
   */
  public readonly acceptInvitation = $action({
    method: "POST",
    path: `${this.url}/:id/accept`,
    group: this.group,
    use: [$secure()],
    description: "Accept a pending invitation addressed to the current user",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({
        ok: z.boolean(),
        projectId: z.string(),
      }),
    },
    handler: async ({ params, user }) => {
      const result = await this.invitationService.accept(params.id, user);
      return { ok: true, projectId: result.projectId };
    },
  });

  /**
   * Decline an invitation by id. Same email-binding posture as accept.
   */
  public readonly declineInvitation = $action({
    method: "POST",
    path: `${this.url}/:id/decline`,
    group: this.group,
    use: [$secure()],
    description: "Decline a pending invitation addressed to the current user",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.invitationService.decline(params.id, user);
      return { ok: true };
    },
  });
}
