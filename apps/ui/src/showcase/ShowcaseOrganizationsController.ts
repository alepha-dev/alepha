import { $inject, z } from "alepha";
import {
  createOrganizationSchema,
  organizationInvitations,
  organizationMemberResourceSchema,
  organizationRankResourceSchema,
  organizations,
  organizationSummaryResourceSchema,
} from "alepha/api/organizations";
import { permissionCatalogueSchema } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { ShowcaseOrganizations } from "./ShowcaseOrganizations.ts";

/**
 * Contract-compatible actions for the organization showcase.
 *
 * The action names and schemas match `alepha/api/organizations`; the paths
 * stay under `/showcase` so the fixture surface is visibly separate from an
 * application's production API.
 */
export class ShowcaseOrganizationsController {
  protected readonly organizations = $inject(ShowcaseOrganizations);

  public readonly getMyOrganizations = $action({
    path: "/showcase/organizations",
    schema: { response: z.array(organizationSummaryResourceSchema) },
    handler: () => this.organizations.organizations(),
  });

  public readonly createOrganization = $action({
    method: "POST",
    path: "/showcase/organizations",
    schema: { body: createOrganizationSchema, response: organizations.schema },
    handler: ({ body }) => this.organizations.organization(body.name),
  });

  public readonly getOrganizationMembers = $action({
    path: "/showcase/organizations/:organizationId/members",
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: z.array(organizationMemberResourceSchema),
    },
    handler: ({ params }) => this.organizations.members(params.organizationId),
  });

  public readonly removeOrganizationMember = $action({
    method: "DELETE",
    path: "/showcase/organizations/:organizationId/members/:userId",
    schema: {
      params: z.object({ organizationId: z.uuid(), userId: z.uuid() }),
      response: okSchema,
    },
    handler: () => ({ ok: true }),
  });

  public readonly leaveOrganization = $action({
    method: "POST",
    path: "/showcase/organizations/:organizationId/leave",
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: okSchema,
    },
    handler: () => ({ ok: true }),
  });

  public readonly transferOrganizationOwnership = $action({
    method: "POST",
    path: "/showcase/organizations/:organizationId/transfer",
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      body: z.object({
        userId: z.uuid(),
        rank: z.text({ maxLength: 64 }).optional(),
      }),
      response: okSchema,
    },
    handler: () => ({ ok: true }),
  });

  public readonly assignOrganizationRank = $action({
    method: "PUT",
    path: "/showcase/organizations/:organizationId/ranks/assignments/:userId",
    schema: {
      params: z.object({ organizationId: z.uuid(), userId: z.uuid() }),
      body: z.object({ key: z.text({ minLength: 1, maxLength: 64 }) }),
      response: okSchema,
    },
    handler: () => ({ ok: true }),
  });

  public readonly getOrganizationInvitations = $action({
    path: "/showcase/organizations/:organizationId/invitations",
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: z.array(organizationInvitations.schema),
    },
    handler: ({ params }) =>
      this.organizations.invitations(params.organizationId),
  });

  public readonly createOrganizationInvitation = $action({
    method: "POST",
    path: "/showcase/organizations/:organizationId/invitations",
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      body: z.object({
        email: z.string().meta({ format: "email" }),
        rank: z.text({ maxLength: 64 }).optional(),
        metadata: z.record(z.string(), z.any()).optional(),
      }),
      response: organizationInvitations.schema,
    },
    handler: ({ params, body }) => ({
      ...this.organizations.invitations(params.organizationId)[0],
      email: body.email,
      rank: body.rank,
      metadata: body.metadata,
    }),
  });

  public readonly revokeOrganizationInvitation = $action({
    method: "POST",
    path: "/showcase/organizations/:organizationId/invitations/:invitationId/revoke",
    schema: {
      params: z.object({
        organizationId: z.uuid(),
        invitationId: z.uuid(),
      }),
      response: okSchema,
    },
    handler: () => ({ ok: true }),
  });

  public readonly getMyOrganizationInvitations = $action({
    path: "/showcase/organizations/invitations/me",
    schema: {
      response: z.array(
        organizationInvitations.schema.extend({
          organizationName: z.string().optional(),
        }),
      ),
    },
    handler: () => this.organizations.myInvitations(),
  });

  public readonly acceptOrganizationInvitation = $action({
    method: "POST",
    path: "/showcase/organizations/invitations/:invitationId/accept",
    schema: {
      params: z.object({ invitationId: z.uuid() }),
      response: z.object({ organizationId: z.uuid() }),
    },
    handler: () => ({
      organizationId: this.organizations.myInvitations()[0].organizationId,
    }),
  });

  public readonly declineOrganizationInvitation = $action({
    method: "POST",
    path: "/showcase/organizations/invitations/:invitationId/decline",
    schema: {
      params: z.object({ invitationId: z.uuid() }),
      response: okSchema,
    },
    handler: () => ({ ok: true }),
  });

  public readonly getOrganizationRankCatalogue = $action({
    path: "/showcase/organizations/:organizationId/ranks/catalogue",
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: permissionCatalogueSchema,
    },
    handler: () => this.organizations.catalogue(),
  });

  public readonly getOrganizationRanks = $action({
    path: "/showcase/organizations/:organizationId/ranks",
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: z.object({ items: z.array(organizationRankResourceSchema) }),
    },
    handler: () => ({ items: this.organizations.ranks() }),
  });

  public readonly saveOrganizationRank = $action({
    method: "PUT",
    path: "/showcase/organizations/:organizationId/ranks/:key",
    schema: {
      params: z.object({
        organizationId: z.uuid(),
        key: z.text({ minLength: 1, maxLength: 64 }),
      }),
      body: z.object({
        name: z.text({ minLength: 1, maxLength: 100 }),
        permissions: z.array(z.text()),
      }),
      response: organizationRankResourceSchema,
    },
    handler: ({ params, body }) => ({
      key: params.key,
      name: body.name,
      permissions: body.permissions,
      builtin: ["owner", "member"].includes(params.key),
      editable: params.key !== "owner",
    }),
  });

  public readonly deleteOrganizationRank = $action({
    method: "DELETE",
    path: "/showcase/organizations/:organizationId/ranks/:key",
    schema: {
      params: z.object({ organizationId: z.uuid(), key: z.text() }),
      response: okSchema,
    },
    handler: () => ({ ok: true }),
  });
}
