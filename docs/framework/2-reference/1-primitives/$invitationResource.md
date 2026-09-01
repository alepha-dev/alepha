# $invitationResource

## Import

```typescript
import { $invitationResource } from "alepha/api/invitations";
```

## Overview

Teach the invitation module about one kind of resource.

```ts
class ProjectInvitations {
  project = $invitationResource({
    type: "project",
    assertCanInvite: (id, inviter) => this.security.assertOwner(+id, inviter),
    assertRoom: (id) => this.limits.assertRoom(+id),
    isPrincipal: (id, who) => this.members.has(+id, who),
    grant: (userId, invitation) =>
      this.members.add(+invitation.resourceId, userId),
    describe: (invitation) => this.describe(invitation),
  });
}
```

## Options

| Option            | Type     | Required | Description                                                                                                                                                                                                |
| ----------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`            | `string` | Yes      | The `resourceType` this resolver answers for, e.g                                                                                                                                                          |
| `assertCanInvite` | `Object` | Yes      | May this inviter invite anyone to this resource at all? Throw if not                                                                                                                                       |
| `assertRoom`      | `Object` | No       | Is there room for one more principal? Throw if not                                                                                                                                                         |
| `isPrincipal`     | `Object` | Yes      | Is this person already a principal on this resource? Identified by `userId` when there is an account and by `email` when there is not one yet, which is why both are passed and only `email` is guaranteed |
| `grant`           | `Object` | Yes      | Make the accepting user a principal                                                                                                                                                                        |
| `describe`        | `Object` | No       | How a human sees this invitation: what they are being invited to, and by whom                                                                                                                              |
