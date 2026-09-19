import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type HomeProjectsFilterRow,
  homeProjectMatches,
} from "./homeProjectsFilter.ts";

describe("homeProjectMatches", () => {
  let dt: DateTimeProvider;

  beforeEach(() => {
    dt = Alepha.create().inject(DateTimeProvider);
    dt.pause();
  });

  const daysAgo = (days: number) =>
    dt.now().subtract(days, "day").toDate().toISOString();

  const project = (
    options: Partial<HomeProjectsFilterRow> = {},
  ): HomeProjectsFilterRow => ({
    title: options.title ?? "Lore",
    owner: options.owner ?? true,
    updatedAt: options.updatedAt ?? daysAgo(0),
  });

  describe("ownership", () => {
    it("keeps only the projects the viewer owns under 'owned'", () => {
      const filters = { ownership: "owned" } as const;

      expect(
        homeProjectMatches(dt, project({ owner: true }), filters, undefined),
      ).toBe(true);
      expect(
        homeProjectMatches(dt, project({ owner: false }), filters, undefined),
      ).toBe(false);
    });

    it("keeps only the projects the viewer does not own under 'notOwned'", () => {
      const filters = { ownership: "notOwned" } as const;

      expect(
        homeProjectMatches(dt, project({ owner: false }), filters, undefined),
      ).toBe(true);
      expect(
        homeProjectMatches(dt, project({ owner: true }), filters, undefined),
      ).toBe(false);
    });
  });

  describe("activity", () => {
    it("calls a project dormant from the seventh day without activity", () => {
      const dormant = { activity: "dormant" } as const;
      const active = { activity: "active" } as const;

      // Six days is still the week the row is not muted in.
      expect(homeProjectMatches(dt, project(), dormant, daysAgo(6))).toBe(
        false,
      );
      expect(homeProjectMatches(dt, project(), active, daysAgo(6))).toBe(true);
      expect(homeProjectMatches(dt, project(), dormant, daysAgo(7))).toBe(true);
      expect(homeProjectMatches(dt, project(), active, daysAgo(7))).toBe(false);
    });

    it("reads the board's last activity over the project's own updatedAt", () => {
      // Edited a month ago, a quest moved today: active.
      const row = project({ updatedAt: daysAgo(30) });

      expect(
        homeProjectMatches(dt, row, { activity: "active" }, daysAgo(0)),
      ).toBe(true);
    });

    it("falls back to updatedAt before the board arrives", () => {
      const row = project({ updatedAt: daysAgo(30) });

      expect(
        homeProjectMatches(dt, row, { activity: "dormant" }, undefined),
      ).toBe(true);
    });
  });

  it("combines the filters with the search box", () => {
    const row = project({ title: "Alepha Lore", owner: false });

    expect(
      homeProjectMatches(
        dt,
        row,
        { search: "lore", ownership: "notOwned", activity: "active" },
        daysAgo(1),
      ),
    ).toBe(true);
    expect(
      homeProjectMatches(
        dt,
        row,
        { search: "shop", ownership: "notOwned" },
        daysAgo(1),
      ),
    ).toBe(false);
  });

  it("lets everything through with no filter set", () => {
    expect(
      homeProjectMatches(dt, project({ owner: false }), {}, daysAgo(90)),
    ).toBe(true);
  });
});
