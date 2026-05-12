import { $inject, t } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";
import { createInvitationSchema } from "../schemas/createInvitationSchema.ts";
import { invitationResourceSchema } from "../schemas/invitationResourceSchema.ts";
import { invitationWithResourceInfoSchema } from "../schemas/invitationWithResourceInfoSchema.ts";
import { myInvitationsQuerySchema } from "../schemas/myInvitationsQuerySchema.ts";
import { InvitationService } from "../services/InvitationService.ts";

export class InvitationController {
  protected readonly url = "/invitations";
  protected readonly group = "invitations";
  protected readonly invitationService = $inject(InvitationService);

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
   * List invitations for the current user.
   */
  public readonly getMyInvitations = $action({
    path: `${this.url}/mine`,
    group: this.group,
    use: [$secure()],
    description: "List invitations for the current user",
    schema: {
      query: myInvitationsQuerySchema,
      response: t.array(invitationWithResourceInfoSchema),
    },
    handler: ({ query, user }) =>
      this.invitationService.findByEmail(user.email!, query),
  });

  /**
   * Accept an invitation.
   */
  public readonly acceptInvitation = $action({
    method: "POST",
    path: `${this.url}/:id/accept`,
    group: this.group,
    use: [$secure()],
    description: "Accept an invitation",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.invitationService.accept(params.id, user);
      return { ok: true };
    },
  });

  /**
   * Decline an invitation.
   */
  public readonly declineInvitation = $action({
    method: "POST",
    path: `${this.url}/:id/decline`,
    group: this.group,
    use: [$secure()],
    description: "Decline an invitation",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.invitationService.decline(params.id, user);
      return { ok: true };
    },
  });
}
