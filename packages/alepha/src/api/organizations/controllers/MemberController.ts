import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { organizationMemberResourceSchema } from "../schemas/organizationMemberResourceSchema.ts";
import { $ownsOrganization } from "../security/$ownsOrganization.ts";
import { MemberService } from "../services/MemberService.ts";

/**
 * Membership routes: list, remove, leave, transfer.
 *
 * **No route adds a member or sets a rank here.** Both used to exist, gated
 * on `member:manage` alone, and both bypassed the guards that matter: a rank
 * holding `member:manage` could promote itself, hand out ranks beyond its own
 * permissions, and add any platform user without consent and past the
 * organization's member cap (#Q2506). The guarded paths are the only ones:
 * a rank changes through `OrganizationRankController.assignOrganizationRank`
 * (`RankService.assign`: no self-change, nothing beyond the writer's own
 * permissions), and a member joins by accepting an invitation (consent, and
 * `OrganizationPolicyProvider.assertRoom`).
 */
export class MemberController {
  protected readonly members = $inject(MemberService);

  public readonly getOrganizationMembers = $action({
    path: "/organizations/:organizationId/members",
    use: [
      $ownsOrganization({ param: "organizationId", requires: "member:read" }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: z.array(organizationMemberResourceSchema),
    },
    handler: ({ params }) => this.members.listResources(params.organizationId),
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
