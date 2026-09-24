# Organizations

`alepha/api/organizations` provides organizations, members, ownership, ranks,
and invitations as one coherent boundary.

```typescript check
import { AlephaApiOrganizations } from "alepha/api/organizations";
```

The module owns four related rows:

- an organization with a name, optional slug, logo, and metadata;
- a membership that links one user to one organization and carries a rank;
- a rank definition scoped to one organization;
- an invitation addressed to an email address and scoped to one organization.

Keeping these together matters. Membership is the authority row used by
resource authorization, the rank is stored on that same row, and accepting an
invitation creates that row. There is one owner rank and every organization is
created with an owner membership.

## Organizations and members

`OrganizationController` provides create, list, read, update, and delete
actions. `MemberController` lists, adds, removes, and ranks members, and owns
the explicit leave and ownership transfer actions.

Ownership is transferred, never assigned as an ordinary rank. The transfer
updates the old and new owner together, so an organization is not left with
zero or two owners. The owner cannot leave or be removed until ownership has
been transferred.

Applications can narrow creation, deletion, capacity, and refusal policy by
substituting `OrganizationPolicyProvider`:

```typescript
import { OrganizationPolicyProvider } from "alepha/api/organizations";

class AppOrganizationPolicy extends OrganizationPolicyProvider {
  public override async assertRoom(organizationId: string): Promise<void> {
    // Apply the application's subscription or seat policy here.
  }
}

alepha.with({
  provide: OrganizationPolicyProvider,
  use: AppOrganizationPolicy,
});
```

The provider also exposes `assertCanCreate`, `assertCanDelete`, `ownedBy`, and
`refuse`. The module supplies permissive defaults except for the structural
membership, owner, and rank invariants.

## Resource authorization

Use `$ownsOrganization` when a route is directly scoped to an organization:

```typescript
read = $action({
  path: "/organizations/:organizationId/report",
  use: [
    $ownsOrganization({
      param: "organizationId",
      requires: "report:read",
    }),
  ],
  handler: () => this.report.read(),
});
```

The primitive is `$owns` configured with `organization_members`. It checks
membership and hands `requires` to the module's `RankGrantsProvider`.
Application permission and organization rank permission are both required.

For a resource whose route names an application row rather than the
organization, pass its repository and use `key` to identify the organization
column on the authority row:

```typescript
$ownsOrganization({
  repository: () => this.projects,
  param: "projectId",
  key: "organizationId",
  requires: "project:update",
});
```

Here `$owns` loads the project, then matches memberships with
`project.organizationId`. A missing or null key fails closed. `through` is
also available for routes whose row belongs to another authority row.

## Ranks

A rank answers what somebody may do inside one organization. Roles remain
application-wide; ranks vary by organization for the same user.

The module creates two built-ins:

- `owner`, which grants `*` and cannot be edited or assigned;
- `member`, which starts from `organizationConfigAtom.memberPermissions` and
  can be customized.

Anything else is a custom rank the owner creates. The module seeds none: an
organization starts with these two, and `@alepha/ui`'s `OrganizationRanks`
editor offers a blank rank plus whatever `presets` the application passes it
(Lore's Admin, Contributor and Viewer), each saved as an ordinary custom rank
under a fresh key.

The effective set includes `organizationConfigAtom.floor`. Permissions in
`ownerOnly` can never be granted to another rank. A writer also cannot grant a
permission they do not hold, change their own assignment, remove a rank that
somebody holds, or edit their rank into a self-lockout.

Rank definitions are cached. Assignments are not: the membership row is read
for each authorization decision, so a demotion or removal applies on the next
request.

`OrganizationRankController` provides the permission catalogue, rank list,
save, delete, and assignment actions under
`/organizations/:organizationId/ranks`. These actions use the same policy as
the authorization gate, so a custom editor cannot bypass the module's
invariants.

## Invitations

An organization invitation is keyed by email rather than user ID, so it can
address someone who has no account without creating a placeholder user. Its
status moves from `pending` to `accepted`, `declined`, `expired`, or `revoked`.

Creating an invitation checks the inviter's rank, validates the target rank,
checks organization capacity through `OrganizationPolicyProvider.assertRoom`,
and enforces the configured pending caps. Acceptance checks capacity again,
because two pending invitations may race for the last seat.

The `organization:invitation:created` hook carries the one-time token. Send it
using the application's own mail and registration URL:

```typescript
$hook({
  on: "organization:invitation:created",
  handler: async ({ invitation, token }) => {
    await this.mail.push({
      contact: invitation.email,
      variables: {
        url: `${base}/auth/register?invitation=${encodeURIComponent(token)}`,
      },
    });
  },
});
```

The token is valid only while the invitation is pending, unexpired, and bound
to the registering email address. Revocation changes status instead of
deleting the row, preserving the audit trail until the purge job removes old
resolved invitations.

## Closed-realm signup

An invitation can admit its recipient while ordinary registration stays
closed. Connect the module's `InvitationRegistrationService` to `$realm`:

```typescript
realm = $realm({
  settings: { registrationAllowed: false },
  isPreAuthorized: (context) =>
    this.alepha.inject(InvitationRegistrationService).preAuthorize(context),
});
```

A credentials registration must present the token. A verified OAuth address
can use its pending invitation because the token does not survive the provider
round trip. A valid token proves the email address and avoids sending a second
verification message.

## Configuration and jobs

`organizationConfigAtom` configures the member default, permission floor,
owner-only ceiling, invitation expiry, pending caps, and resolved-invitation
retention. `OrganizationInvitationJobs` expires overdue invitations and
purges old resolved rows hourly. Set `invitationPurgeDays` to `0` to keep the
audit rows indefinitely.

## See also

- [Resource Authorization](/docs/guides-server-resource-authorization)
- [Authentication](/docs/guides-server-authentication)
