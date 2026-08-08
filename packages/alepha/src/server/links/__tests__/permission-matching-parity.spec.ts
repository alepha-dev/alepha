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
 * never disagree about whether a caller holds a permission — a guard that
 * denies what the UI shows (or vice versa) is worse than either behaviour on
 * its own.
 *
 * Only permission-shaped names are compared. `LinkProvider.can()` also resolves
 * bare action names against its action map, which is not a permission question
 * and has no counterpart on the security side.
 */
describe("permission matching parity", () => {
  const cases: Array<{ granted: string[]; required: string; label: string }> = [
    { granted: ["orders:read"], required: "orders:read", label: "exact hit" },
    {
      granted: ["orders:read"],
      required: "orders:delete",
      label: "exact miss",
    },
    { granted: ["orders:read"], required: "orders:*", label: "wildcard hit" },
    {
      granted: ["invoices:read"],
      required: "orders:*",
      label: "wildcard miss",
    },
    { granted: [], required: "orders:read", label: "empty registry" },
    {
      granted: ["orders:read", "orders:delete"],
      required: "orders:delete",
      label: "hit among several",
    },
    {
      granted: ["orders:read:own"],
      required: "orders:read:*",
      label: "nested wildcard",
    },
  ];

  for (const { granted, required, label } of cases) {
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

        expect(registry.can(required)).toBe(links.can(required));
      });
    });
  }
});
