import { $inject } from "alepha";
import type {
  Organization,
  OrganizationInvitation,
  OrganizationMemberResource,
  OrganizationRankResource,
  OrganizationSummaryResource,
} from "alepha/api/organizations";
import type { PermissionCatalogue } from "alepha/security";

import { ShowcaseUsers } from "./admin/ShowcaseUsers.ts";

/**
 * Deterministic in-memory data for every organization screen.
 *
 * The showcase is a shared public reference, so mutations return valid
 * contract-shaped results without changing the seed. A visitor can exercise
 * every dialog and action without changing what the next visitor sees.
 */
export class ShowcaseOrganizations {
  protected readonly users = $inject(ShowcaseUsers);

  public organizations(): OrganizationSummaryResource[] {
    return [
      { ...this.organization(), rank: "owner" },
      {
        id: "00000000-0000-4000-a000-000000000002",
        createdAt: "2026-02-10T09:00:00.000Z",
        updatedAt: "2026-08-18T14:30:00.000Z",
        name: "Compiler Collective",
        slug: "compiler-collective",
        rank: "member",
      },
    ];
  }

  public organization(name = "Analytical Engines"): Organization {
    return {
      id: "00000000-0000-4000-a000-000000000001",
      createdAt: "2026-01-03T09:00:00.000Z",
      updatedAt: "2026-09-01T11:20:00.000Z",
      name,
      slug: "analytical-engines",
    };
  }

  public members(organizationId: string): OrganizationMemberResource[] {
    const users = this.users.rows();
    return [
      this.member(organizationId, users[0], "owner", 1),
      this.member(organizationId, users[1], "maintainer", 2),
      this.member(organizationId, users[2], "member", 3),
    ];
  }

  public invitations(organizationId: string): OrganizationInvitation[] {
    return [
      {
        id: "00000000-0000-4000-a100-000000000001",
        version: 1,
        createdAt: "2026-09-10T10:00:00.000Z",
        updatedAt: "2026-09-10T10:00:00.000Z",
        organizationId,
        invitedBy: this.users.rows()[0].id,
        email: "charles@alepha.dev",
        status: "pending",
        rank: "maintainer",
        expiresAt: "2026-10-10T10:00:00.000Z",
      },
    ];
  }

  public myInvitations(): Array<
    OrganizationInvitation & { organizationName?: string }
  > {
    return [
      {
        id: "00000000-0000-4000-a100-000000000002",
        version: 1,
        createdAt: "2026-09-12T13:00:00.000Z",
        updatedAt: "2026-09-12T13:00:00.000Z",
        organizationId: "00000000-0000-4000-a000-000000000003",
        organizationName: "Difference Lab",
        invitedBy: this.users.rows()[3].id,
        email: "ada@alepha.dev",
        status: "pending",
        rank: "member",
        expiresAt: "2026-10-12T13:00:00.000Z",
      },
    ];
  }

  public ranks(): OrganizationRankResource[] {
    return [
      {
        key: "owner",
        name: "Owner",
        permissions: ["organization:*", "member:*", "invitation:*", "rank:*"],
        builtin: true,
        editable: false,
      },
      {
        key: "maintainer",
        name: "Maintainer",
        permissions: [
          "organization:read",
          "member:read",
          "member:manage",
          "invitation:create",
          "rank:manage",
        ],
        builtin: false,
        editable: true,
      },
      {
        key: "member",
        name: "Member",
        permissions: ["organization:read", "member:read"],
        builtin: true,
        editable: true,
      },
    ];
  }

  public catalogue(): PermissionCatalogue {
    return {
      groups: [
        {
          name: "organization",
          permissions: [
            { name: "organization:read", description: "View the organization" },
            {
              name: "organization:update",
              description: "Change organization settings",
            },
          ],
        },
        {
          name: "members",
          permissions: [
            { name: "member:read", description: "View members" },
            { name: "member:manage", description: "Manage members" },
            {
              name: "invitation:create",
              description: "Invite new members",
            },
          ],
        },
        {
          name: "ranks",
          permissions: [{ name: "rank:manage", description: "Manage ranks" }],
        },
      ],
    };
  }

  protected member(
    organizationId: string,
    user: OrganizationMemberResource["user"],
    rank: string,
    index: number,
  ): OrganizationMemberResource {
    return {
      id: `00000000-0000-4000-a200-${String(index).padStart(12, "0")}`,
      createdAt: `2026-03-0${index}T09:00:00.000Z`,
      updatedAt: `2026-08-0${index}T09:00:00.000Z`,
      organizationId,
      userId: user.id,
      rank,
      user,
    };
  }
}
