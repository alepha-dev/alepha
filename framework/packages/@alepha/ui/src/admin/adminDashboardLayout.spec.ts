import { describe, expect, it } from "vitest";

import type { AdminDashboardCard } from "./AdminDashboardCard.tsx";
import {
  adminDashboardCatalog,
  adminDashboardLayoutEntries,
  adminDashboardLayoutOf,
  resolveAdminDashboardLayout,
} from "./adminDashboardLayout.ts";

const card = (
  id: string,
  extra: Partial<AdminDashboardCard> = {},
): AdminDashboardCard => ({
  id,
  title: id,
  render: () => null,
  ...extra,
});

const ids = (cards: AdminDashboardCard[]) => cards.map((c) => c.id);

/**
 * The dashboard's catalog and layout resolution (#Q3537): one pure function
 * between what code registers and what an admin saved.
 */
describe("resolveAdminDashboardLayout", () => {
  const catalog = [
    card("users", { order: 1000 }),
    card("connected", { order: 1010 }),
    card("shop", { order: 0 }),
    card("beta", { order: 5, defaultEnabled: false }),
  ];

  it("is the code defaults without a layout: catalog order, defaultEnabled only", () => {
    expect(ids(resolveAdminDashboardLayout(catalog))).toEqual([
      "shop",
      "users",
      "connected",
    ]);
    expect(ids(resolveAdminDashboardLayout(catalog, []))).toEqual([
      "shop",
      "users",
      "connected",
    ]);
  });

  it("follows the layout's order and shows its enabled tiles only", () => {
    const tiles = [
      { id: "connected", enabled: true },
      { id: "users", enabled: false },
      { id: "beta", enabled: true },
      { id: "shop", enabled: true },
    ];
    expect(ids(resolveAdminDashboardLayout(catalog, tiles))).toEqual([
      "connected",
      "beta",
      "shop",
    ]);
  });

  it("drops a layout id the catalog no longer has, silently", () => {
    const tiles = [
      { id: "retired", enabled: true },
      { id: "users", enabled: true },
    ];
    expect(ids(resolveAdminDashboardLayout(catalog, tiles))).toContain("users");
    expect(ids(resolveAdminDashboardLayout(catalog, tiles))).not.toContain(
      "retired",
    );
  });

  it("appends a tile the layout does not name yet when it is defaultEnabled", () => {
    // A layout saved before `connected` and `beta` shipped.
    const tiles = [
      { id: "users", enabled: true },
      { id: "shop", enabled: false },
    ];
    expect(ids(resolveAdminDashboardLayout(catalog, tiles))).toEqual([
      "users",
      "connected",
    ]);
  });

  it("applies can() last, so a layout never shows a tile over a missing module", () => {
    const gated = [card("users", { can: () => false }), card("connected")];
    expect(
      ids(
        resolveAdminDashboardLayout(gated, [
          { id: "users", enabled: true },
          { id: "connected", enabled: true },
        ]),
      ),
    ).toEqual(["connected"]);
  });
});

describe("adminDashboardLayoutEntries", () => {
  it("lists every catalog card, unavailable ones included, for the picker", () => {
    const gated = [card("users", { can: () => false }), card("connected")];
    const entries = adminDashboardLayoutEntries(gated, [
      { id: "users", enabled: true },
    ]);
    expect(entries.map((e) => [e.card.id, e.enabled])).toEqual([
      ["users", true],
      ["connected", true],
    ]);
  });

  it("round-trips through the layout it saves", () => {
    const catalog = [card("a"), card("b"), card("c")];
    const entries = adminDashboardLayoutEntries(catalog, [
      { id: "c", enabled: true },
      { id: "a", enabled: false },
    ]);
    const saved = adminDashboardLayoutOf(entries);
    expect(saved.tiles).toEqual([
      { id: "c", enabled: true },
      { id: "a", enabled: false },
      { id: "b", enabled: true },
    ]);
    expect(adminDashboardLayoutEntries(catalog, saved.tiles)).toEqual(entries);
  });
});

describe("adminDashboardCatalog", () => {
  it("throws on a duplicate id", () => {
    expect(() => adminDashboardCatalog([card("users"), card("users")])).toThrow(
      "share the id 'users'",
    );
  });

  it("keeps declaration order between equal orders", () => {
    expect(
      ids(
        adminDashboardCatalog([card("b"), card("a"), card("c", { order: -1 })]),
      ),
    ).toEqual(["c", "b", "a"]);
  });
});
