import type { ListApiKeyItem } from "alepha/api/keys";
import type { MyProfile } from "alepha/api/users";

/**
 * One person, seen from every account screen.
 *
 * Shared rather than one literal per page so the five pages describe the same
 * account: a reader moving between Profile and Sessions should not find they
 * have changed identity. A plain module of literals, not a fixture factory -
 * nothing here is generated and nothing varies per call.
 *
 * `MyProfile` is the real response type on purpose. It was `as never` once, and
 * the cast hid a missing `roles` until the page threw at runtime.
 */
export const SHOWCASE_PROFILE: MyProfile = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "ada@alepha.dev",
  username: "ada",
  firstName: "Ada",
  lastName: "Lovelace",
  emailVerified: true,
  roles: ["owner", "admin"],
  createdAt: "2026-01-01T09:30:00.000Z",
  lastLoginAt: "2026-09-05T08:15:00.000Z",
};

/**
 * One current session and one not, because `current` is what the component
 * draws differently and what it refuses to let you revoke.
 */
export const SHOWCASE_SESSIONS = [
  {
    id: "s1",
    current: true,
    ip: "203.0.113.10",
    country: "FR",
    createdAt: "2026-09-05T07:00:00.000Z",
    lastUsedAt: "2026-09-05T08:40:00.000Z",
    userAgent: { os: "macOS", browser: "Chrome", device: "DESKTOP" },
  },
  {
    id: "s2",
    current: false,
    ip: "203.0.113.24",
    country: "GB",
    createdAt: "2026-09-03T19:12:00.000Z",
    lastUsedAt: "2026-09-04T21:05:00.000Z",
    userAgent: { os: "iOS", browser: "Safari", device: "MOBILE" },
  },
];

/**
 * One key in every state the row draws: live with no expiry, live with a
 * scope and a far expiry, expiring soon, expired (which keeps Rotate) and
 * revoked (which keeps nothing).
 *
 * `ListApiKeyItem` is the real response type. It was `as never` while the
 * endpoint could not describe a revoked row; the cast is gone with that gap.
 */
export const SHOWCASE_KEYS: ListApiKeyItem[] = [
  {
    id: "00000000-0000-4000-b000-000000000011",
    name: "CLI on my laptop",
    tokenPrefix: "ak",
    tokenSuffix: "9f2a",
    roles: ["owner"],
    permissions: [],
    createdAt: "2026-08-20T09:00:00.000Z",
    lastUsedAt: "2026-09-05T06:30:00.000Z",
    usageCount: 412,
    status: "active",
  },
  {
    id: "00000000-0000-4000-b000-000000000012",
    name: "Grafana",
    description: "Reads project metrics every minute",
    tokenPrefix: "ak",
    tokenSuffix: "41bd",
    roles: ["owner"],
    permissions: ["project:read", "quest:read"],
    createdAt: "2026-07-01T09:00:00.000Z",
    lastUsedAt: "2026-09-05T08:59:00.000Z",
    expiresAt: "2027-01-01T09:00:00.000Z",
    usageCount: 40311,
    status: "active",
  },
  {
    id: "00000000-0000-4000-b000-000000000013",
    name: "CI pipeline",
    description: "Deploys from GitHub Actions",
    tokenPrefix: "ak",
    tokenSuffix: "77c0",
    roles: ["owner"],
    permissions: [],
    createdAt: "2026-06-10T09:00:00.000Z",
    lastUsedAt: "2026-09-05T07:10:00.000Z",
    // Relative to the moment the showcase loads, unlike every other date
    // here: an "expiring" badge reading "expires 5 days ago" would be the
    // one lie a fixed date tells about this state.
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    usageCount: 96,
    status: "expiring",
  },
  {
    id: "00000000-0000-4000-b000-000000000014",
    name: "Nightly import",
    tokenPrefix: "ak",
    tokenSuffix: "0e13",
    roles: ["owner"],
    permissions: [],
    createdAt: "2026-03-02T09:00:00.000Z",
    lastUsedAt: "2026-08-30T02:00:00.000Z",
    expiresAt: "2026-09-01T09:00:00.000Z",
    usageCount: 180,
    status: "expired",
  },
  {
    id: "00000000-0000-4000-b000-000000000015",
    name: "Old script",
    tokenPrefix: "ak",
    tokenSuffix: "1c07",
    roles: ["owner"],
    permissions: [],
    createdAt: "2026-05-02T09:00:00.000Z",
    revokedAt: "2026-08-01T09:00:00.000Z",
    usageCount: 38,
    status: "revoked",
  },
];

export const SHOWCASE_CONNECTIONS = [
  {
    id: "c1",
    clientId: "lore-mcp",
    clientName: "Lore MCP",
    scopes: ["projects:read", "quests:write"],
    createdAt: "2026-07-14T10:00:00.000Z",
  },
  {
    id: "c2",
    clientId: "alepha-cli",
    clientName: "Alepha CLI",
    scopes: ["deploy"],
    createdAt: "2026-08-28T16:20:00.000Z",
  },
];

/**
 * Linked sign-in providers, for the security screen. One of each shape the row
 * can take: a provider with an email attached and one without.
 */
export const SHOWCASE_IDENTITIES = [
  {
    id: "i1",
    provider: "github",
    email: "ada@alepha.dev",
    createdAt: "2026-01-01T09:30:00.000Z",
  },
  {
    id: "i2",
    provider: "google",
    createdAt: "2026-04-18T14:02:00.000Z",
  },
];
