import AccountConnections from "@alepha/ui/components/account/account-connections";
import AccountKeys from "@alepha/ui/components/account/account-keys";
import AccountProfile from "@alepha/ui/components/account/account-profile";
import AccountSessions from "@alepha/ui/components/account/account-sessions";
import type { MyProfile } from "alepha/api/users";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

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

/**
 * The `/account` surface, rendered from props.
 *
 * Every one of these takes its data as an OPTIONAL prop and calls the API only
 * for mutations - `AccountProfile`'s own comment says the prop is optional "so
 * the page can also be rendered standalone in a story". That is exactly this
 * situation, and it is why the account block needs no session: the read path is
 * a prop, so only revoking and saving would reach a server, and those are
 * answered by `ShowcaseAccountController`.
 *
 * `AccountSecurity` is deliberately absent. It reads `useAuth()` for the signed
 * in identity, and this site has no realm to sign into: it would render an
 * account belonging to nobody, which is worse than not showing it.
 */
const Account = () => (
  <BlockPage
    title="Account"
    description="What a signed-in person manages about themselves."
  >
    <Specimen
      title="AccountProfile"
      description="The avatar is cropped in the browser."
    >
      {/*
        Typed as `MyProfile` rather than cast. The first draft used `as never`
        and omitted `roles`, which the component reads as `profile.roles.length`
        - so the page died with "Cannot read properties of undefined" instead of
        failing to compile. A cast here buys nothing and costs the one check
        that would have caught it.
      */}
      <AccountProfile profile={PROFILE} />
    </Specimen>

    <Specimen
      title="AccountSessions"
      description="Revoke one, or sign out everywhere else."
    >
      <AccountSessions
        sessions={
          [
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
          ] as never
        }
      />
    </Specimen>

    <Specimen
      title="AccountKeys"
      description="The token is shown exactly once."
    >
      <AccountKeys
        apiKeys={
          [
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
          ] as never
        }
      />
    </Specimen>

    <Specimen
      title="AccountConnections"
      description="Applications holding OAuth access."
    >
      <AccountConnections
        connections={
          [
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
          ] as never
        }
      />
    </Specimen>
  </BlockPage>
);

export default Account;
