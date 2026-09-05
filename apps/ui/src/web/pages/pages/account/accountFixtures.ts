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
 * One live key and one revoked, which is the only pair that shows both states
 * of the row.
 */
export const SHOWCASE_KEYS = [
  {
    id: "k1",
    name: "CLI on my laptop",
    tokenPrefix: "ak_cli",
    tokenSuffix: "9f2a",
    createdAt: "2026-08-20T09:00:00.000Z",
    lastUsedAt: "2026-09-05T06:30:00.000Z",
    usageCount: 412,
  },
  {
    id: "k2",
    name: "Old script",
    tokenPrefix: "ak_old",
    tokenSuffix: "1c07",
    createdAt: "2026-05-02T09:00:00.000Z",
    revokedAt: "2026-08-01T09:00:00.000Z",
    usageCount: 38,
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
