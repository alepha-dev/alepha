# Alepha - Api Invitations

## Installation

Part of the `alepha` package. Import from `alepha/api/invitations`.

```bash
npm install alepha
```

## Overview

Invite people to something by email, before they have an account.

**Features:**

- Invitations addressed to an email, so a stranger can be invited
- A status machine: pending to accepted / declined / expired / revoked
- Expiry and purge sweeps, on an hourly job
- Caps per resource and per inviter
- An admin surface behind `admin:invitation:*`

The module knows nothing about what is being joined. Declare one
`$invitationResource` per `resourceType` to tell it who may invite, whether
there is room, who is already a principal, what accepting grants and how
the whole thing reads to a human.

## API Reference

### Primitives

- [`$invitationResource`](/docs/reference-primitives-$invitationresource) - Teach the invitation module about one kind of resource.

### Providers

- [`InvitationResourceProvider`](/docs/reference-providers-invitationresourceprovider) - The registry of `$invitationResource` declarations, keyed by
