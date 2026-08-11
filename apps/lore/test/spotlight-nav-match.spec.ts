import { describe, expect, it } from "vitest";
import type { ProjectNavEntry } from "../src/web/app/atoms/projectNavAtom.ts";
import { matchProjectNav } from "../src/web/app/components/shared/spotlight/matchProjectNav.ts";

const page = (label: string): ProjectNavEntry => ({
  label,
  href: `/p/1/${label.toLowerCase()}`,
  kind: "page",
});
const app = (label: string): ProjectNavEntry => ({
  label,
  href: `/p/1/apps/${label}`,
  kind: "app",
});

const SIDEBAR: ProjectNavEntry[] = [
  page("Quests"),
  page("Feedback"),
  page("Milestones"),
  page("Folios"),
  page("Reports"),
  app("portfolio"),
  app("folio-service"),
  page("Settings"),
];

const labels = (rows: ProjectNavEntry[]) => rows.map((r) => r.label);

describe("matchProjectNav — pages and apps in the palette (#190)", () => {
  it("offers nothing until something is typed", () => {
    expect(matchProjectNav(SIDEBAR, "")).toEqual([]);
    expect(matchProjectNav(SIDEBAR, "   ")).toEqual([]);
  });

  it("offers nothing when no project is open", () => {
    expect(matchProjectNav(undefined, "fol")).toEqual([]);
  });

  it("ranks an earlier match first, so a page beats a lookalike app", () => {
    // "Folios" and "folio-service" both start at 0, "portfolio" at 4.
    expect(labels(matchProjectNav(SIDEBAR, "fol"))).toEqual([
      "Folios",
      "folio-service",
      "portfolio",
    ]);
  });

  it("breaks a tie on label length — the shorter label is more specific", () => {
    expect(labels(matchProjectNav(SIDEBAR, "folio"))[0]).toBe("Folios");
  });

  it("matches case-insensitively and mid-label", () => {
    expect(labels(matchProjectNav(SIDEBAR, "STONE"))).toEqual(["Milestones"]);
  });

  it("returns nothing when the query is really content, not a page", () => {
    expect(matchProjectNav(SIDEBAR, "the analytics outage register")).toEqual(
      [],
    );
  });

  it("caps the list so content is never pushed off-screen", () => {
    const many = Array.from({ length: 20 }, (_, i) => page(`Page ${i}`));
    expect(matchProjectNav(many, "page")).toHaveLength(6);
    expect(matchProjectNav(many, "page", 2)).toHaveLength(2);
  });
});
