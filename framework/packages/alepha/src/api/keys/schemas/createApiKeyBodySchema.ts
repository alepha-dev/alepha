import { z } from "alepha";

import { apiKeyExpiresInSchema } from "./apiKeyExpiresInSchema.ts";

export const createApiKeyBodySchema = z.object({
  name: z.text({ minLength: 1, maxLength: 100 }),
  description: z.text({ maxLength: 500 }).optional(),
  /**
   * How long the key lives, resolved on the server. Prefer it to `expiresAt`:
   * it is what the expiry policy is expressed in.
   */
  expiresIn: apiKeyExpiresInSchema.optional(),
  /**
   * An exact expiry, for programmatic callers. Checked against the same
   * policy as `expiresIn`; pass one or the other.
   */
  expiresAt: z.datetime().optional(),
  /**
   * Narrow the key to these permissions, below what its roles grant: full
   * `group:name` strings the application registers, never patterns. Omit, or
   * pass `[]`, for a key with everything its roles allow. Each must be one
   * the caller may grant (its own roles and scope), or creation is refused
   * naming it.
   */
  permissions: z.array(z.text()).max(500).optional(),
  /**
   * Restrict the key to requests from these client addresses: bare IPv4 or
   * IPv6 addresses (`203.0.113.4`, `2001:db8::1`) and CIDR ranges
   * (`198.51.100.0/24`, `2001:db8::/32`). Omit, or pass `[]`, for a key usable
   * from anywhere. A malformed entry refuses the creation, naming it. The
   * list cannot be edited afterwards: to change it, revoke the key and create
   * a new one, which may reuse the name.
   *
   * ⚠️ The check is only as trustworthy as the client address the server
   * resolves, and `TRUST_PROXY` defaults to `true`. With it on, the address is
   * read from `cf-connecting-ip`, `X-Forwarded-For` or `X-Real-IP` before the
   * socket. Behind a proxy that sets those headers itself (Cloudflare, a load
   * balancer, a reverse proxy that overwrites them), that is the real client
   * and the allowlist means what it says. On a server that takes connections
   * directly, those headers come from the client: anyone holding the key can
   * send `X-Real-IP: 203.0.113.4` and pass an allowlist naming that address.
   * Such a deployment must set `TRUST_PROXY=false` for this field to restrict
   * anything.
   */
  ipAllowlist: z
    .array(z.text({ maxLength: 64 }))
    .max(100)
    .optional(),
});
