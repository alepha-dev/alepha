import { Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";

import { $permission, $secure, SecurityProvider } from "../index.ts";

/**
 * The permission registry read as a catalogue: what a permission matrix
 * renders itself from.
 *
 * The point of reading it out of the registry rather than out of an
 * application-defined array is that a grant can then be checked against
 * something real - "this rank names a permission nothing declares" is an
 * answerable question only when there is one list.
 */
describe("permission catalogue", () => {
  it("groups and orders the registry, unordered groups last", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class App {
      questCreate = $permission({
        group: "quest",
        name: "create",
        label: "permissions.quest.create",
        groupLabel: "permissions.quest.group",
        groupOrder: 2,
      });

      questRead = $permission({
        group: "quest",
        name: "read",
        label: "permissions.quest.read",
      });

      projectRead = $permission({
        group: "project",
        name: "read",
        label: "permissions.project.read",
        groupLabel: "permissions.project.group",
        groupOrder: 1,
      });

      // No `groupOrder` anywhere in this group.
      folioWrite = $permission({ group: "folio", name: "write" });
    }

    alepha.inject(App);
    await alepha.start();

    const catalogue = alepha
      .inject(SecurityProvider)
      .permissionCatalogue()
      .filter((it) => ["project", "quest", "folio"].includes(it.name));

    expect(catalogue.map((it) => it.name)).toEqual([
      "project",
      "quest",
      "folio",
    ]);

    expect(catalogue[0].label).toBe("permissions.project.group");
    expect(catalogue[0].order).toBe(1);

    // The group's label and order came from ONE of its permissions; the other
    // declared neither and is still in the group.
    expect(catalogue[1].label).toBe("permissions.quest.group");
    expect(catalogue[1].permissions.map((it) => it.name)).toEqual([
      "create",
      "read",
    ]);

    expect(catalogue[2].order).toBeUndefined();
  });

  it("enriches a bare registration from $secure with a later label", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    // `$secure` registers `folio:write` bare, at class-field initialisation
    // time. Whether it runs before or after the `$permission` below is class
    // ordering, which nobody should have to reason about - so the answer has
    // to be the same either way.
    class Gate {
      guard = $secure({ permissions: ["folio:write"] });
    }

    class Catalogue {
      folioWrite = $permission({
        group: "folio",
        name: "write",
        label: "permissions.folio.write",
        groupOrder: 7,
      });
    }

    alepha.inject(Gate);
    alepha.inject(Catalogue);
    await alepha.start();

    const group = alepha
      .inject(SecurityProvider)
      .permissionCatalogue()
      .find((it) => it.name === "folio");

    expect(group?.order).toBe(7);
    expect(group?.permissions).toHaveLength(1);
    expect(group?.permissions[0].label).toBe("permissions.folio.write");
  });

  it("enriches in the other declaration order too", async ({ expect }) => {
    const alepha = Alepha.create();

    class Catalogue {
      folioWrite = $permission({
        group: "folio",
        name: "write",
        label: "permissions.folio.write",
      });
    }

    class Gate {
      guard = $secure({ permissions: ["folio:write"] });
    }

    alepha.inject(Catalogue);
    alepha.inject(Gate);
    await alepha.start();

    const group = alepha
      .inject(SecurityProvider)
      .permissionCatalogue()
      .find((it) => it.name === "folio");

    expect(group?.permissions[0].label).toBe("permissions.folio.write");
  });

  it("refuses two declarations that disagree about a label", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class App {
      first = $permission({
        group: "folio",
        name: "write",
        label: "permissions.folio.write",
      });

      second = $permission({
        group: "folio",
        name: "write",
        label: "something.else",
      });
    }

    expect(() => alepha.inject(App)).toThrow(AlephaError);
  });
});
