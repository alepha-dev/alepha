import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, SecurityProvider } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreApi } from "../src/api/index.ts";
import { LorePermissions } from "../src/api/security/LorePermissions.ts";
import { CapabilityRegistry } from "../src/api/services/CapabilityRegistry.ts";

/**
 * The permission groups no capability claims, and that are therefore always
 * shown in the rank matrix.
 *
 * Written out rather than derived, because "everything left over" is exactly
 * the reading that lets a new group become invisible: a permission whose group
 * nobody claims and nobody listed here would gate real endpoints and appear in
 * no matrix, so no rank could ever be given it and nothing would say why.
 *
 * All six describe the CONTAINER rather than a surface inside it. A project
 * with every capability switched off still has members, still gets renamed,
 * still has ranks to edit and still shows its Reports page.
 */
const ALWAYS_SHOWN = [
  "project",
  "member",
  "rank",
  "capability",
  "invitation",
  "stats",
];

interface Ctx {
  alepha: Alepha;
  security: SecurityProvider;
  capabilities: CapabilityRegistry;
  /**
   * The groups LORE declares, read off the primitives themselves.
   *
   * Scoped that way on purpose. The registry also holds every permission the
   * FRAMEWORK's own modules declare - `admin:user:read`, `api-key:create`,
   * `file:read` - and those are instance-scope: they never reach a project's
   * rank matrix, so they need no label and no capability. Asserting over the
   * whole registry would fail on them and teach nothing.
   */
  declared: string[];
}

/**
 * Pinned `DATABASE_URL`, like every other lore spec: the ROOT vitest config
 * points it at Postgres, which this app's SQLite provider refuses outright.
 */
const setup = async (): Promise<Ctx> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const permissions = alepha.inject(LorePermissions);

  await alepha.start();

  const declared = [
    ...new Set(
      Object.values(permissions as unknown as Record<string, { group: string }>)
        .filter((it) => typeof it?.group === "string")
        .map((it) => it.group),
    ),
  ];

  return {
    alepha,
    security: alepha.inject(SecurityProvider),
    capabilities: alepha.inject(CapabilityRegistry),
    declared,
  };
};

describe("permission groups and capabilities", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * The one that matters: a group nothing claims is a group that gates
   * endpoints and appears in no matrix.
   */
  it("leaves no permission group unclaimed and unlisted", ({ expect }) => {
    const orphans = ctx.declared.filter(
      (name) =>
        !ALWAYS_SHOWN.includes(name) &&
        !ctx.capabilities.ownerOfPermissionGroup(name),
    );

    expect(orphans).toEqual([]);
  });

  it("claims no group twice", ({ expect }) => {
    const seen = new Map<string, string>();
    for (const capability of ctx.capabilities.all()) {
      for (const group of capability.permissionGroups) {
        const first = seen.get(group);
        // Two capabilities claiming one group means the matrix renders that
        // section under whichever is enabled, which is not a rule anybody
        // could state.
        expect(first).toBeUndefined();
        seen.set(group, capability.key);
      }
    }
  });

  it("never claims a Core group for a capability", ({ expect }) => {
    for (const group of ALWAYS_SHOWN) {
      expect(ctx.capabilities.ownerOfPermissionGroup(group)).toBeUndefined();
    }
  });

  it("declares a label for every permission and every group", ({ expect }) => {
    const unlabelled: string[] = [];

    for (const group of ctx.security
      .permissionCatalogue()
      .filter((it) => ctx.declared.includes(it.name))) {
      if (!group.label) {
        unlabelled.push(`group:${group.name}`);
      }
      for (const permission of group.permissions) {
        if (!permission.label) {
          unlabelled.push(`${group.name}:${permission.name}`);
        }
      }
    }

    // A permission with no label renders as its raw `group:name` string in the
    // matrix. That is the failure this catches: `$secure()` registers a bare
    // entry for every string it is handed, so a permission used at a call site
    // and never declared in `LorePermissions` is silently label-less.
    expect(unlabelled).toEqual([]);
  });
});
