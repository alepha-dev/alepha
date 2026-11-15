import { LoreViewerAllowlist } from "@lore/core/api";
import { Alepha } from "alepha";
import { oauthOptions } from "alepha/api/oauth";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, SecurityProvider } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterAll, beforeAll, describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";
import { LoreOAuthScopes } from "../src/api/security/LoreOAuthScopes.ts";
import { LoreCoreMcp } from "../src/mcp/index.ts";

/**
 * The Viewer allowlist against the permission registry Lore boots with.
 *
 * The lists in `LoreViewerAllowlist` are written out, so this is what keeps
 * them true: a group added later fails here until somebody decides whether a
 * viewer of an open project reads it.
 */
describe("LoreViewerAllowlist", () => {
  let alepha: Alepha;
  let permissions: string[];

  beforeAll(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha
      .with(AlephaOrm)
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaEmail)
      .with(AlephaApiUsers)
      .with(AlephaMcp);
    alepha.set(oauthOptions, {
      realm: "users",
      resource: "/mcp",
      loginPath: "/auth/login",
      scopes: LoreOAuthScopes.SCOPES,
    });
    alepha.with(LoreCoreApi).with(LoreCoreMcp);
    await alepha.start();

    permissions = alepha
      .inject(SecurityProvider)
      .permissionCatalogueFor()
      .groups.flatMap((group) => group.permissions.map((it) => it.name));
  });

  afterAll(async () => {
    await alepha.stop();
  });

  const groupOf = (permission: string) => permission.split(":")[0];

  it("classifies every registered permission group as read or closed", ({
    expect,
  }) => {
    const unplaced = [
      ...new Set(
        permissions
          .map(groupOf)
          .filter(
            (group) =>
              !LoreViewerAllowlist.READ_GROUPS.includes(group) &&
              !LoreViewerAllowlist.CLOSED_GROUPS.includes(group),
          ),
      ),
    ];

    expect(
      unplaced,
      "a new permission group: add it to LoreViewerAllowlist.READ_GROUPS or CLOSED_GROUPS",
    ).toEqual([]);
  });

  it("places no group on both lists", ({ expect }) => {
    expect(
      LoreViewerAllowlist.READ_GROUPS.filter((group) =>
        LoreViewerAllowlist.CLOSED_GROUPS.includes(group),
      ),
    ).toEqual([]);
  });

  it("lists only permissions the registry has", ({ expect }) => {
    expect(
      LoreViewerAllowlist.PERMISSIONS.filter(
        (permission) => !permissions.includes(permission),
      ),
    ).toEqual([]);
  });

  it("holds reads only, and none of what a viewer must never read", ({
    expect,
  }) => {
    expect(
      LoreViewerAllowlist.PERMISSIONS.every((it) => it.endsWith(":read")),
    ).toBe(true);
    for (const leak of [
      "automation:read",
      "app:read",
      "error:read",
      "host:read",
      "member:read",
      "feedback:read",
      "stats:read",
    ]) {
      expect(LoreViewerAllowlist.PERMISSIONS).not.toContain(leak);
    }
  });

  it("names the extras of a set, wildcards included", ({ expect }) => {
    expect(
      LoreViewerAllowlist.extrasOf(["project:read", "quest:read"]),
    ).toEqual([]);
    expect(
      LoreViewerAllowlist.extrasOf([
        "quest:read",
        "quest:update",
        "quest:*",
        "*",
      ]),
    ).toEqual(["quest:update", "quest:*", "*"]);
  });
});
