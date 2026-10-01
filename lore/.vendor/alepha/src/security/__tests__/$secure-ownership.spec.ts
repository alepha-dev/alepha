import { $pipeline, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import { $role, $secure } from "../index.ts";

/**
 * `permissions` is an AND list. Each entry can narrow the grant to rows the
 * caller owns (`ownership: true`), and `$owns` treats `ownership === false` as
 * a full bypass of its row check. Combining them must therefore take the MOST
 * RESTRICTIVE answer — and must not depend on the order they were listed in.
 */

class Roles {
  editor = $role({
    name: "editor",
    permissions: [
      { name: "docs:read", ownership: true }, // own rows only
      { name: "docs:list" }, // every row
    ],
  });
}

const ownershipFor = async (permissions: string[]) => {
  const alepha = Alepha.create();

  class App {
    fn = $pipeline({
      use: [$secure({ permissions })],
      handler: async () => alepha.store.get(currentUserAtom)?.ownership,
    });
  }

  alepha.inject(Roles);
  const app = alepha.inject(App);
  await alepha.start();

  const result = await alepha.context.run(async () => {
    alepha.store.set(currentUserAtom, {
      id: "u1",
      realm: "default",
      roles: ["editor"],
    });
    return app.fn();
  });

  await alepha.stop();
  return result;
};

describe("$secure permission ownership", () => {
  it("should not depend on the order permissions are listed in", async () => {
    const readFirst = await ownershipFor(["docs:read", "docs:list"]);
    const listFirst = await ownershipFor(["docs:list", "docs:read"]);

    expect(readFirst).toEqual(listFirst);
  });

  it("should keep the owner-scoped restriction when any permission requires it", async () => {
    expect(await ownershipFor(["docs:read", "docs:list"])).toBe(true);
    expect(await ownershipFor(["docs:list", "docs:read"])).toBe(true);
  });

  it("should stay unrestricted when no permission requires ownership", async () => {
    expect(await ownershipFor(["docs:list"])).toBe(false);
  });

  it("should stay owner-scoped for a single owner-scoped permission", async () => {
    expect(await ownershipFor(["docs:read"])).toBe(true);
  });
});
