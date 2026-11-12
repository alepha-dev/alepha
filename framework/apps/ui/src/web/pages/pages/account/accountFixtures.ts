import type { ListApiKeyItem } from "alepha/api/keys";
import type { MyProfile } from "alepha/api/users";

/**
 * One person, seen from every account screen.
 *
 * Shared rather than one literal per page so every screen describes the same
 * account: the organizations pages and the API keys showcase. A plain module of literals, not a fixture factory -
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
    ipAllowlist: [],
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
    ipAllowlist: [],
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
    ipAllowlist: ["192.0.2.0/24", "2001:db8:c1::/48"],
    createdAt: "2026-06-10T09:00:00.000Z",
    lastUsedAt: "2026-09-05T07:10:00.000Z",
    // Relative to today, unlike every other date here: an "expiring" badge
    // reading "expires 5 days ago" would be the one lie a fixed date tells
    // about this state. Whole UTC days, never the exact instant: the server
    // evaluates this module when it boots and the browser when the page
    // loads, and the exact datetime `TimeAgo` renders on both sides must be
    // the same string or hydration fails.
    expiresAt: new Date(
      (Math.floor(Date.now() / 86_400_000) + 4) * 86_400_000,
    ).toISOString(),
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
    ipAllowlist: [],
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
    ipAllowlist: [],
    createdAt: "2026-05-02T09:00:00.000Z",
    revokedAt: "2026-08-01T09:00:00.000Z",
    usageCount: 38,
    status: "revoked",
  },
];
