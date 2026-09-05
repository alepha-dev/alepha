import AccountConnections from "@alepha/ui/components/account/account-connections";
import AccountKeys from "@alepha/ui/components/account/account-keys";
import AccountProfile from "@alepha/ui/components/account/account-profile";
import AccountSessions from "@alepha/ui/components/account/account-sessions";
import { z } from "alepha";
import type { MyProfile } from "alepha/api/users";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The `/account` surface. Every component takes its data as an OPTIONAL prop
 * and calls the API only for mutations, which is why it needs no session.
 *
 * `AccountSecurity` is absent on purpose: it reads `useAuth()` and would render
 * an account belonging to nobody.
 */
const KNOBS = z.object({
  screen: z
    .enum(["profile", "sessions", "keys", "connections"])
    .default("profile")
    .meta({ title: "Screen" }),
  empty: z.boolean().default(false).meta({ title: "Empty state" }),
});

const PROFILE: MyProfile = {
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

const SESSIONS = [
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

const KEYS = [
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

const CONNECTIONS = [
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

const Account = () => (
  <Showcase
    title="Account"
    description="What a signed-in person manages about themselves."
    schema={KNOBS}
    initialValues={{ screen: "profile", empty: false }}
  >
    {(v) => (
      <div className="mx-auto max-w-3xl">
        {v.screen === "profile" ? (
          <AccountProfile profile={v.empty ? undefined : PROFILE} />
        ) : null}
        {v.screen === "sessions" ? (
          <AccountSessions sessions={(v.empty ? [] : SESSIONS) as never} />
        ) : null}
        {v.screen === "keys" ? (
          <AccountKeys apiKeys={(v.empty ? [] : KEYS) as never} />
        ) : null}
        {v.screen === "connections" ? (
          <AccountConnections
            connections={(v.empty ? [] : CONNECTIONS) as never}
          />
        ) : null}
      </div>
    )}
  </Showcase>
);

export default Account;
