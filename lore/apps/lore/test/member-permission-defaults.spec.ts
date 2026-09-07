import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, SecurityProvider } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreApi } from "../src/api/index.ts";
import { LorePermissions } from "../src/api/security/LorePermissions.ts";

/**
 * The acceptance criterion of epic #E39, as a test.
 *
 * "No existing project changes behaviour" is a claim about ONE list: what the
 * built-in `member` rank grants. A project that never touches its ranks gets
 * that list and nothing else, so if it matches what a plain member could do
 * before the epic, nothing changed for anybody.
 *
 * The list itself cannot be derived from the gates by a test - a gate's
 * `owner: true` lives in a `use:` array that no reflection reaches - so it is
 * written out on `LorePermissions` and what this file pins is the shape around
 * it: every declared permission is on exactly one side, and the two sides say
 * what they mean.
 */
interface Ctx {
  alepha: Alepha;
  security: SecurityProvider;
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

  const declared = Object.values(
    permissions as unknown as Record<string, { toString(): string }>,
  )
    .filter((it) => typeof it?.toString === "function")
    .map((it) => it.toString())
    .filter((it) => it.includes(":"));

  return { alepha, security: alepha.inject(SecurityProvider), declared };
};

describe("the default member permission set", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("covers every declared permission exactly once", ({ expect }) => {
    const partitioned = [
      ...LorePermissions.MEMBER_DEFAULT,
      ...LorePermissions.OWNER_TODAY,
      ...LorePermissions.OUT_OF_SCOPE,
    ];

    // A permission on neither side is one nobody decided about: the built-in
    // `member` rank would not carry it and no preset would either, so it would
    // be gated by an endpoint and reachable by nobody but the owner, silently.
    const undecided = ctx.declared.filter((it) => !partitioned.includes(it));
    expect(undecided).toEqual([]);

    // And the reverse: a list naming a permission nothing declares is a rule
    // about a string the registry has never heard of.
    const phantom = partitioned.filter((it) => !ctx.declared.includes(it));
    expect(phantom).toEqual([]);

    // Exactly once, so `project:read` cannot be both a member default and an
    // owner-only act.
    expect(new Set(partitioned).size).toBe(partitioned.length);
  });

  it("keeps the floor inside the member default", ({ expect }) => {
    for (const floor of LorePermissions.FLOOR) {
      expect(LorePermissions.MEMBER_DEFAULT).toContain(floor);
      expect(LorePermissions.OWNER_TODAY).not.toContain(floor);
    }
  });

  it("keeps the ceiling out of it, and inside what only an owner does", ({
    expect,
  }) => {
    for (const ceiling of LorePermissions.OWNER_ONLY) {
      expect(LorePermissions.MEMBER_DEFAULT).not.toContain(ceiling);
      expect(LorePermissions.OWNER_TODAY).toContain(ceiling);
    }
  });

  it("registers every permission it partitions", ({ expect }) => {
    const registered = new Set(
      ctx.security
        .getPermissions()
        .map((it) => (it.group ? `${it.group}:${it.name}` : it.name)),
    );

    for (const permission of ctx.declared) {
      expect(registered.has(permission)).toBe(true);
    }
  });
});
