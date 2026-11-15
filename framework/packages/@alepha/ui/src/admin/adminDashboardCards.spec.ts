import { describe, expect, it } from "vitest";

import type { AdminDashboardCard } from "./AdminDashboardCard.tsx";
import {
  adminDashboardCatalog,
  visibleAdminDashboardCards,
} from "./adminDashboardCards.ts";

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
 * The dashboard's tiles are declared in code and nothing else (#Q3667): the
 * catalog in `order`, each card past its own gate.
 */
describe("visibleAdminDashboardCards", () => {
  it("shows the catalog in order, and only the cards whose gate passes", () => {
    expect(
      ids(
        visibleAdminDashboardCards([
          card("users", { order: 1000 }),
          card("connected", { order: 1010, can: () => false }),
          card("shop", { order: 0 }),
        ]),
      ),
    ).toEqual(["shop", "users"]);
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
