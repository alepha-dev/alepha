# Invitations

`alepha/api/invitations` invites someone by **email address**, before they
have an account.

That is the whole reason the module exists. An invitation keyed on a user id
would have to invent a user row for every address nobody ever accepts, and
those ghost rows occupy the email-uniqueness slot forever: a later
self-registration at that address fails with "email already exists". Keying
on the address means one row serves both cases, and the status machine
(`pending` to `accepted` / `declined` / `expired` / `revoked`) is the same
whether or not the person already exists.

```typescript check
import { AlephaApiInvitations } from "alepha/api/invitations";
```

## What the module knows, and what it refuses to

It owns the invitation: the address, the status machine, the expiry, the caps,
the hourly expire and purge sweeps, the events, and an admin surface behind
`admin:invitation:*`.

It knows nothing about what is being joined. `resourceType` and `resourceId`
are opaque strings; the module never parses an id whose shape it cannot know.
Six questions do need to know, and an application answers them once per
resource kind with `$invitationResource`.

```typescript
import { $invitationResource } from "alepha/api/invitations";

class ProjectInvitations {
  project = $invitationResource({
    type: "project",
    assertCanInvite: async (resourceId, inviter) => {
      await this.security.assertOwner(Number(resourceId), inviter);
    },
    assertRoom: (resourceId) => this.assertRoomForOneMore(resourceId),
    isPrincipal: (resourceId, principal) =>
      this.isMember(Number(resourceId), principal),
    grant: (userId, invitation) =>
      this.addMember(Number(invitation.resourceId), userId),
    describe: (invitation) => this.describe(invitation),
  });
}
```

| Closure           | Asked at              | The question                             |
| ----------------- | --------------------- | ---------------------------------------- |
| `assertCanInvite` | create                | may this inviter invite to this resource |
| `assertRoom`      | create **and** accept | is there room                            |
| `isPrincipal`     | create and accept     | is this person already on it             |
| `grant`           | accept                | what does accepting give them            |
| `describe`        | inbox reads           | how does this read to a human            |

`assertCanInvite` is the authorization gate, and nothing else in `create`
checks who the inviter is. It is the application's because only the
application knows what owning one of these means.

Registering two resolvers for one `type` is refused at boot rather than
silently shadowing the first: two answers to "may this inviter invite" for the
same rows, with the later registration winning, is not a thing to discover in
production.

## Two things that look redundant and are not

**`assertRoom` is asked twice.** Pending invitations are capped separately from
principals, so a resource one seat short of its limit can hold several of
them. Asking at create is what tells the owner before anyone is emailed;
asking again at accept is what separates two invitations racing for the last
seat, because that is where the principal is actually written.

**`isPrincipal` takes an address, not just a user id.** At create time the
invitee may have no account at all. `email` is always supplied and `userId`
only once there is one, so an application whose membership is keyed on user
ids resolves the address itself. The module holds no users table, on purpose:
`invitedBy` is a bare uuid with no foreign key, exactly like `api/keys` and
`api/audits`, so the module works in an app that registers no user module of
its own.

## Reading an inbox

```typescript
const rows = await this.invitations.listForUser(user);
```

Each row is the invitation plus whatever its own resolver could say about it.
A row whose `resourceType` no longer has a resolver is listed **undescribed**
rather than skipped: its owner still has to be able to decline it, and failing
the whole inbox over one such row would be worse.

`accept` names the resource generically, as `{ resourceType, resourceId }`. An
application that speaks a single language to its own clients maps that back at
the controller.

## Caps and sweeps

`invitationConfigAtom` (`alepha.api.invitations.config`) carries four numbers:
`expirationDays`, `maxPendingPerResource`, `maxPendingPerInviter` and
`purgeDays`. `InvitationJobs` runs hourly: it flips overdue pending rows to
`expired`, and deletes resolved rows older than `purgeDays`. Set `purgeDays`
to `0` to keep them forever.

Revoking flips the status; it does **not** delete. `accept` and `decline` both
refuse anything that is not `pending`, so a revoked invitation is dead
immediately while the audit trail survives until the purge.

## Events

`invitation:created`, `invitation:accepted`, `invitation:declined`,
`invitation:expired`, `invitation:revoked`. The mail an invitation sends is
the application's: hook `invitation:created` and send whatever your product
should say.

## Multi-tenancy

`organizationId` is nullable, following `parameters`. A single-tenant app
resolves no tenant and keeps writing NULL rows with global semantics. A pooled
multi-tenant worker gets isolation for free: the Repository stamps the active
tenant on write and filters by it on read, so one org's pending invitations
can never be listed, revoked or accepted from another.

## See also

- [Resource Authorization](/docs/guides-server-resource-authorization)
- [Authentication](/docs/guides-server-authentication), whose "Letting One Address Into a
  Closed Realm" is what makes an invitation usable when self-registration is
  off
