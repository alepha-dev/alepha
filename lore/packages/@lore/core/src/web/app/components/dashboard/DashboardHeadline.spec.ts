import { describe, it } from "vitest";

import type { DashboardCardResource } from "../../../../api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../../../../api/schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "../../../../api/schemas/DashboardMetricCatalog.ts";
import en from "../../../locales/en.ts";
import fr from "../../../locales/fr.ts";
import { DashboardHeadline } from "./DashboardHeadline.ts";

/**
 * The computed board's opening line (#Q2663): one clause per rendered tile,
 * from its resolved value, joined by the locale's own rules.
 */
describe("DashboardHeadline", () => {
  const catalog = new DashboardMetricCatalog();
  const base = {
    boards: ["project" as const],
    group: "core" as const,
    labelKey: "x",
    hintKey: "x",
    icon: "x",
    presentation: "scalar" as const,
    scopeKinds: ["projects" as const],
    filters: {} as never,
    link: () => undefined,
  };
  catalog.register({
    ...base,
    key: "release",
    order: 1,
    clause: (value) => ({
      key: "dashboard.clause.releaseShips",
      args: ["0.33.0", "6", String(value.value)],
    }),
  });
  catalog.register({
    ...base,
    key: "needs",
    order: 2,
    clause: (value) =>
      (value.value ?? 0) > 0
        ? { key: "dashboard.clause.needsYou", args: [String(value.value)] }
        : undefined,
  });
  catalog.register({
    ...base,
    key: "week",
    order: 3,
    clause: (value) => ({
      key: "dashboard.clause.completedThisWeek",
      args: [String(value.value)],
    }),
  });

  const card = (id: number, metric: string) =>
    ({
      id,
      metric,
      scope: { kind: "all" },
      filters: {},
      size: 1,
      position: id,
    }) as DashboardCardResource;
  const value = (
    cardId: number,
    over: Partial<DashboardCardValue> = {},
  ): DashboardCardValue => ({
    cardId,
    ok: true,
    detail: {},
    scopeNames: [],
    ...over,
  });
  const trOf =
    (dictionary: Record<string, string>) =>
    (key: never, options?: { args?: string[] }) =>
      (options?.args ?? []).reduce(
        (text, arg, index) => text.replace(`$${index + 1}`, arg),
        dictionary[key as string] ?? (key as string),
      );

  const cards = [card(1, "release"), card(2, "needs"), card(3, "week")];
  const values = [
    value(1, { value: 78 }),
    value(2, { value: 3 }),
    value(3, { value: 12 }),
  ];

  it("joins one clause per rendered tile, in board order, in English", ({
    expect,
  }) => {
    expect(
      new DashboardHeadline().build(cards, values, catalog, trOf(en), "en"),
    ).toBe(
      "0.33.0 ships in 6 days and is 78% done, 3 things need you, and 12 quests were completed this week.",
    );
  });

  it("follows the French word order and joining rules", ({ expect }) => {
    expect(
      new DashboardHeadline().build(cards, values, catalog, trOf(fr), "fr"),
    ).toBe(
      "La version 0.33.0 sort dans 6 jours, avancée à 78 %, 3 points vous attendent et 12 quêtes ont été terminées cette semaine.",
    );
  });

  it("says nothing for a tile that is not on the board, empty or failed", ({
    expect,
  }) => {
    const sentence = new DashboardHeadline().build(
      [card(1, "release"), card(2, "needs")],
      [value(1, { ok: false }), value(2, { value: 3, empty: "noData" })],
      catalog,
      trOf(en),
      "en",
    );

    expect(sentence).toBeUndefined();
  });

  it("leaves out a clause its metric declines", ({ expect }) => {
    const sentence = new DashboardHeadline().build(
      [card(2, "needs"), card(3, "week")],
      [value(2, { value: 0 }), value(3, { value: 2 })],
      catalog,
      trOf(en),
      "en",
    );

    expect(sentence).toBe("2 quests were completed this week.");
  });
});
