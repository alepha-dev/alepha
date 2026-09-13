# API keys

`alepha/api/keys` gives a user long-lived tokens for scripts, CI and other
machines, authenticated by the same issuer as their sessions.

```typescript check
import { AlephaApiKeys } from "alepha/api/keys";
```

## IP allowlist

A key can be restricted to the client addresses it may be used from. The list
is set when the key is created, through the API only, and cannot be edited
afterwards:

```http
POST /api/api-keys
Content-Type: application/json

{
  "name": "CI pipeline",
  "expiresIn": "90d",
  "ipAllowlist": ["203.0.113.4", "198.51.100.0/24", "2001:db8::/32"]
}
```

- Entries are bare IPv4 or IPv6 addresses and CIDR ranges. A malformed entry
  refuses the creation and the error names it: a bad entry discovered only at
  validation time would be a key that silently never works.
- An empty or absent list means the key works from anywhere, which is what
  every key created before the allowlist existed has.
- The check runs inside `ApiKeyService.validate()`, before the owner lookup
  and before any usage is recorded. A refused request answers `401`, and the
  refusal is logged with the address that was observed.
- A restricted key whose request address is unknown is refused. Calling
  `validate(token)` from code without passing the IP fails closed.
- An IPv4 entry matches the IPv4-mapped form a dual-stack server reports
  (`::ffff:203.0.113.4`).
- The account panel and the admin table show the list read-only, so a key
  that stopped working from a new address can be diagnosed on screen.
- Rotating a key keeps its allowlist. To change the list, revoke the key and
  create a new one: revoking frees the name, so the new key can take it.

### ⚠️ The allowlist is only as good as `TRUST_PROXY`

The address checked is the one the server resolves for the request, and
`TRUST_PROXY` defaults to `true`. With it on, the address comes from
`cf-connecting-ip`, then `X-Forwarded-For` (the entry `TRUST_PROXY_HOPS` places
from the right), then `X-Real-IP`, and only then the socket.

- **Behind a proxy that sets those headers itself**, such as Cloudflare or a
  load balancer that overwrites them, the resolved address is the real client
  and the allowlist means what it says.
- **On a server that accepts connections directly**, those headers come from
  the client. Anyone holding the key can send `X-Real-IP: 203.0.113.4` and
  pass an allowlist that names that address. Such a deployment must set
  `TRUST_PROXY=false` for the allowlist to restrict anything.
