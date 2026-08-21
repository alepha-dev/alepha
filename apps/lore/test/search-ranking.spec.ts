import { describe, expect, it } from "vitest";

import { orderSearchHits } from "@/api/searchRanking.ts";

const hit = (kind: string, title: string) => ({ kind, title });
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe("orderSearchHits", () => {
  it("puts an exact title match first", () => {
    const rows = [
      hit("folio", "Folio module notes"),
      hit("quest", "folio"),
      hit("folio", "Something about folio"),
    ];
    expect(titles(orderSearchHits(rows, "folio", false, 10))[0]).toBe("folio");
  });

  it("ranks prefix matches above matches buried in the middle", () => {
    const rows = [
      hit("folio", "A folio deep in the title"),
      hit("folio", "Folio module"),
    ];
    expect(titles(orderSearchHits(rows, "folio", false, 10))).toEqual([
      "Folio module",
      "A folio deep in the title",
    ]);
  });

  it("ranks across kinds, not per kind", () => {
    // The quest is the better match; grouping by type in the UI must not
    // come from the order the tables were queried in.
    const rows = [
      hit("folio", "Notes mentioning ward somewhere"),
      hit("quest", "Ward"),
      hit("directory", "wardrobe"),
    ];
    expect(titles(orderSearchHits(rows, "ward", false, 10))).toEqual([
      "Ward",
      "wardrobe",
      "Notes mentioning ward somewhere",
    ]);
  });

  it("pins the quest first for an id query", () => {
    // `#1` means "quest 1". A folio whose body contains "#1" is a
    // coincidence — before the pin, the tie fell through to alphabetical
    // and the thing actually asked for came last.
    const rows = [
      hit("folio", "probe-wikiLink"),
      hit("folio", "another-probe"),
      hit("quest", "Ward the gate"),
    ];
    expect(titles(orderSearchHits(rows, "#1", true, 10))[0]).toBe(
      "Ward the gate",
    );
  });

  it("does not pin quests when the query is not an id", () => {
    const rows = [hit("folio", "alpha"), hit("quest", "zeta")];
    expect(titles(orderSearchHits(rows, "nomatch", false, 10))).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("caps the list at the limit", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      hit("folio", `folio ${i}`),
    );
    expect(orderSearchHits(rows, "folio", false, 12)).toHaveLength(12);
  });

  it("leaves the caller's array untouched", () => {
    const rows = [hit("folio", "zeta"), hit("folio", "alpha")];
    orderSearchHits(rows, "a", false, 10);
    expect(titles(rows)).toEqual(["zeta", "alpha"]);
  });
});
