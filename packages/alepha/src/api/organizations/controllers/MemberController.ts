import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { organizationMembers } from "../entities/organizationMembers.ts";
import { $ownsOrganization } from "../security/$ownsOrganization.ts";
import { MemberService } from "../services/MemberService.ts";

export class MemberController {
  protected readonly members = $inject(MemberService);

  public readonly getOrganizationMembers = $action({
    path: "/organizations/:organizationId/members",
    use: [
      $ownsOrganization({ param: "organizationId", requires: "member:read" }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: z.array(organizationMembers.schema),
    },
    handler: ({ params }) => this.members.list(params.organizationId),
  });

  public readonly addOrganizationMember = $action({
    method: "POST",
    path: "/organizations/:organizationId/members",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "member:manage",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      body: z.object({
        userId: z.uuid(),
        rank: z.text({ maxLength: 64 }).optional(),
      }),
      response: organizationMembers.schema,
    },
    handler: ({ params, body, user }) =>
      this.members.add(params.organizationId, body.userId, body.rank, user),
  });

  public readonly removeOrganizationMember = $action({
    method: "DELETE",
    path: "/organizations/:organizationId/members/:userId",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "member:manage",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid(), userId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.members.remove(params.organizationId, params.userId, user);
      return { ok: true };
    },
  });

  public readonly leaveOrganization = $action({
    method: "POST",
    path: "/organizations/:organizationId/leave",
    use: [$ownsOrganization({ param: "organizationId" })],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.members.leave(params.organizationId, user);
      return { ok: true };
    },
  });

  public readonly setOrganizationMemberRank = $action({
    method: "PUT",
    path: "/organizations/:organizationId/members/:userId/rank",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "member:manage",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid(), userId: z.uuid() }),
      body: z.object({ rank: z.text({ maxLength: 64 }).optional() }),
      response: organizationMembers.schema,
    },
    handler: ({ params, body, user }) =>
      this.members.setRank(
        params.organizationId,
        params.userId,
        body.rank,
        user,
      ),
  });

  public readonly transferOrganizationOwnership = $action({
    method: "POST",
    path: "/organizations/:organizationId/transfer",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "member:manage",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      body: z.object({
        userId: z.uuid(),
        rank: z.text({ maxLength: 64 }).optional(),
      }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.members.transfer(
        params.organizationId,
        body.userId,
        body.rank,
        user,
      );
      return { ok: true };
    },
  });
}
