import { $inject, z } from "alepha";
import { $action, okSchema } from "alepha/server";

import { organizationMemberResourceSchema } from "../schemas/organizationMemberResourceSchema.ts";
import { $ownsOrganization } from "../security/$ownsOrganization.ts";
import { MemberService } from "../services/MemberService.ts";
import { RankService } from "../services/RankService.ts";

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
  protected readonly ranks = $inject(RankService);

  public readonly getOrganizationMembers = $action({
    path: "/organizations/:organizationId/members",
    use: [
      $ownsOrganization({ param: "organizationId", requires: "member:read" }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: z.array(organizationMemberResourceSchema),
    },
    handler: async ({ params }) => {
      // ⚠️ The rank's NAME travels with each row. The rank list is behind
      // `rank:manage`, so a member who may only read the roster cannot look
      // a key up, and a rank created from the editor has a minted key
      // (`r<time>`) that means nothing on screen. Resolved here rather than
      // in `MemberService`, which `RankService` reaches through the policy
      // provider: injecting it back would be a cycle.
      const [rows, ranks] = await Promise.all([
        this.members.listResources(params.organizationId),
        this.ranks.ranksOf(params.organizationId),
      ]);
      const names = new Map(ranks.map((rank) => [rank.key, rank.name]));
      return rows.map((row) => ({
        ...row,
        rankName: names.get(row.rank ?? MemberService.MEMBER),
      }));
    },
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
