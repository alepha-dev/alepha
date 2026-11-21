import { Alepha } from "alepha";
import { PermissionRegistryProvider } from "alepha/security";
import { describe, expect, it } from "vitest";

import { LinkProvider } from "../providers/LinkProvider.ts";

/**
 * `PermissionRegistryProvider` duplicates the permission-matching rule from
 * `LinkProvider.can()` on purpose: `alepha/security` cannot import
 * `alepha/server/links` at runtime without closing the module cycle
 * `security -> server/links -> security`, which the build's analyzer rejects.
 *
 * Duplicated logic drifts unless something holds it together, so this pins the
 * two against each other. `$secure` in the browser and `useAuth().has` must
 * never disagree about whether a caller holds a permission: a guard that
 * denies what the UI shows (or vice versa) is worse than either behaviour on
 * its own.
 *
 * Only permission-shaped names are compared. `LinkProvider.can()` also resolves
 * bare action names against its action map, which is not a permission question
 * and has no counterpart on the security side.
 */
describe("permission matching parity", () => {
  const cases: Array<{
    granted: string[];
    required: string;
    expected: boolean;
    label: string;
  }> = [
    {
      granted: ["orders:read"],
      required: "orders:read",
      expected: true,
      label: "exact hit",
    },
    {
      granted: ["orders:read"],
      required: "orders:delete",
      expected: false,
      label: "exact miss",
    },
    {
      granted: ["orders:read"],
      required: "orders:*",
      expected: true,
      label: "wildcard hit",
    },
    {
      granted: ["invoices:read"],
      required: "orders:*",
      expected: false,
      label: "wildcard miss",
    },
    {
      granted: [],
      required: "orders:read",
      expected: false,
      label: "empty registry",
    },
    {
      granted: ["orders:read", "orders:delete"],
      required: "orders:delete",
      expected: true,
      label: "hit among several",
    },
    {
      granted: ["orders:read:own"],
      required: "orders:read:*",
      expected: true,
      label: "nested wildcard",
    },
  ];

  for (const { granted, required, expected, label } of cases) {
    it(`agrees on ${label}`, async () => {
      const alepha = Alepha.create();
      const links = alepha.inject(LinkProvider);
      const registry = alepha.inject(PermissionRegistryProvider);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set("alepha.server.request.apiLinks", {
          actions: {},
          permissions: granted,
        });

        // Each against the stated answer, not against the other: two sides
        // that both read nothing would agree on `false` for every case.
        expect(links.can(required)).toBe(expected);
        expect(registry.can(required)).toBe(expected);
      });
    });
  }
});
