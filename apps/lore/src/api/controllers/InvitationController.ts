import { $inject, z } from "alepha";
import {
  createInvitationSchema,
  invitationResourceSchema,
  InvitationService,
} from "alepha/api/invitations";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { invitationInboxItemSchema } from "../schemas/invitationInboxItemSchema.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

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
   * Owner-scoped: take back an invitation that has been sent but not yet
   * answered.
   *
   * `InvitationService.revoke` has existed since the module landed and was
   * reachable only through `AdminInvitationController`, behind
   * `admin:invitation:delete` — so the person who sent an invitation could
   * not withdraw it, and a mistyped address stayed live for the whole
   * expiry window with nothing in the UI to say otherwise.
   *
   * Gated the way `accept` and `decline` are: bare `$secure()`, with the
   * real check in the handler. The permission a caller needs here is not a
   * role, it is owning the project the invitation is for, and that is only
   * knowable after reading the row.
   *
   * ⚠️ `AdminInvitationController` declares the same `url = "/invitations"`
   * and already owns both the obvious name and the obvious path. Its
   * `revokeInvitation` sits at `POST /invitations/:id/revoke` behind
   * `admin:invitation:delete`, so this route may share neither:
   *
   * - the NAME collides loudly. Action names are unique across the whole
   *   app, not per controller, and the app throws `Duplicate action name`
   *   at boot. Typecheck and the unit suite both sail past it.
   * - the PATH collides SILENTLY. Two handlers register the same route and
   *   the admin one answers, so a project owner clicking Revoke got a 403
   *   from a permission they were never meant to need. Nothing goes red;
   *   the feature is simply dead.
   *
   * Hence `project/:projectId` in the path, matching
   * `listProjectInvitations` right above — the owner-scoped half of this
   * controller is addressed through the project, and that is what keeps it
   * out of the admin namespace.
   *
   * ⚠️ It flips the status to `revoked`; it does NOT delete. That is what
   * makes the token dead — `accept` and `decline` both refuse anything
   * whose status is not `pending` — while leaving the audit trail for
   * `purgeResolved` to clear on its own schedule. The row leaves the
   * settings page because `listProjectInvitations` asks for `pending`, not
   * because anything was destroyed.
   */
  public readonly revokeProjectInvitation = $action({
    method: "POST",
    path: `${this.url}/project/:projectId/:id/revoke`,
    group: this.group,
    use: [$secure()],
    description: "Revoke a pending invitation for a project the caller owns",
    schema: {
      params: z.object({ projectId: z.integer(), id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      // Ownership is asserted on the project named in the PATH, so this
      // runs first: it is what makes the assertion below meaningful rather
      // than a check against whatever project the row happens to name.
      await this.security.assertOwner(params.projectId, user);
      const invitation = await this.invitationService.getById(params.id);
      // `resourceType` before `Number(resourceId)`, so a future non-project
      // invitation is never gated against a project that shares its numeric
      // id by coincidence.
      if (
        invitation.resourceType !== "project" ||
        Number(invitation.resourceId) !== params.projectId
      ) {
        throw new BadRequestError("This invitation is not for this project");
      }
      await this.invitationService.revoke(params.id, { id: user.id });
      return { ok: true };
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
      response: z.array(invitationInboxItemSchema),
    },
    // The module answers `resourceTitle`, because it does not know a project
    // from a booking. Lore's inbox has always called it `projectTitle` and
    // still does: renaming a field the UI reads is not part of moving the
    // code that produces it.
    handler: async ({ user }) => {
      const rows = await this.invitationService.listForUser(user);
      return rows.map((row) => ({
        ...row,
        projectTitle: row.resourceTitle ?? "Project",
      }));
    },
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
      return { ok: true, projectId: result.resourceId };
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
