import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { organizationInvitations } from "../entities/organizationInvitations.ts";
import { $ownsOrganization } from "../security/$ownsOrganization.ts";
import { InvitationService } from "../services/InvitationService.ts";
import { InvitationTokenService } from "../services/InvitationTokenService.ts";

export class OrganizationInvitationController {
  protected readonly invitations = $inject(InvitationService);
  protected readonly tokens = $inject(InvitationTokenService);

  public readonly createOrganizationInvitation = $action({
    method: "POST",
    path: "/organizations/:organizationId/invitations",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "invitation:create",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      body: z.object({
        email: z.string().meta({ format: "email" }),
        rank: z.text({ maxLength: 64 }).optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      }),
      response: organizationInvitations.schema,
    },
    handler: ({ params, body, user }) =>
      this.invitations.create(params.organizationId, body, user),
  });

  public readonly getOrganizationInvitations = $action({
    path: "/organizations/:organizationId/invitations",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "member:manage",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: z.array(organizationInvitations.schema),
    },
    handler: ({ params }) => this.invitations.list(params.organizationId),
  });

  public readonly revokeOrganizationInvitation = $action({
    method: "POST",
    path: "/organizations/:organizationId/invitations/:invitationId/revoke",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "member:manage",
      }),
    ],
    schema: {
      params: z.object({
        organizationId: z.uuid(),
        invitationId: z.uuid(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const invitation = await this.invitations.getById(params.invitationId);
      if (invitation.organizationId !== params.organizationId) {
        throw new BadRequestError(
          "Invitation does not belong to this organization",
        );
      }
      await this.invitations.revoke(params.invitationId, user);
      return { ok: true };
    },
  });

  public readonly getMyOrganizationInvitations = $action({
    path: "/organizations/invitations/me",
    use: [$secure()],
    schema: {
      response: z.array(
        organizationInvitations.schema.extend({
          organizationName: z.string().optional(),
        }),
      ),
    },
    handler: ({ user }) => this.invitations.listMine(user),
  });

  public readonly acceptOrganizationInvitation = $action({
    method: "POST",
    path: "/organizations/invitations/:invitationId/accept",
    use: [$secure()],
    schema: {
      params: z.object({ invitationId: z.uuid() }),
      response: z.object({ organizationId: z.uuid() }),
    },
    handler: ({ params, user }) =>
      this.invitations.accept(params.invitationId, user),
  });

  public readonly declineOrganizationInvitation = $action({
    method: "POST",
    path: "/organizations/invitations/:invitationId/decline",
    use: [$secure()],
    schema: {
      params: z.object({ invitationId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.invitations.decline(params.invitationId, user);
      return { ok: true };
    },
  });

  public readonly previewOrganizationInvitationToken = $action({
    path: "/organizations/invitations/preview",
    schema: {
      query: z.object({ token: z.text() }),
      response: z.object({
        status: z.enum([
          "invalid",
          "ok",
          "expired",
          "accepted",
          "declined",
          "revoked",
        ]),
        organizationId: z.uuid().optional(),
        email: z.string().optional(),
      }),
    },
    handler: async ({ query }) => {
      const result = await this.tokens.inspect(query.token);
      return {
        status: result.status,
        organizationId: result.invitation?.organizationId,
        email: result.invitation?.email,
      };
    },
  });
}
