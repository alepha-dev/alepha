import { describe, expect, it } from "vitest";

import { orderSearchHits } from "@/api/searchRanking.ts";

const hit = (kind: string, title: string, shortId?: number) => ({
  kind,
  title,
  shortId,
});
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe("orderSearchHits", () => {
  it("puts an exact title match first", () => {
    const rows = [
      hit("folio", "Folio module notes"),
      hit("quest", "folio"),
      hit("folio", "Something about folio"),
    ];
    expect(titles(orderSearchHits(rows, "folio", undefined, 10))[0]).toBe(
      "folio",
    );
  });

  it("ranks prefix matches above matches buried in the middle", () => {
    const rows = [
      hit("folio", "A folio deep in the title"),
      hit("folio", "Folio module"),
    ];
    expect(titles(orderSearchHits(rows, "folio", undefined, 10))).toEqual([
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
    expect(titles(orderSearchHits(rows, "ward", undefined, 10))).toEqual([
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
      hit("folio", "probe-wikiLink", 37),
      hit("folio", "another-probe", 38),
      hit("quest", "Ward the gate", 1),
    ];
    expect(titles(orderSearchHits(rows, "#1", 1, 10))[0]).toBe("Ward the gate");
  });

  it("pins an exact shortId hit of any kind above a body match", () => {
    // Typing `44` while reading folio #44: the folio, quest #44 and
    // directory #44 are all what was asked for, and come first. The folio
    // whose body merely contains "44" is kept, underneath (quest #1676).
    const rows = [
      hit("folio", "Notes that mention the number somewhere", 37),
      hit("quest", "Quest forty-four", 44),
      hit("folio", "Folio forty-four", 44),
      hit("directory", "Directory forty-four", 44),
    ];
    const ordered = titles(orderSearchHits(rows, "44", 44, 10));
    expect(ordered.slice(0, 3).sort()).toEqual([
      "Directory forty-four",
      "Folio forty-four",
      "Quest forty-four",
    ]);
    expect(ordered[3]).toBe("Notes that mention the number somewhere");
  });

  it("does not pin a quest that matched an id query by title only", () => {
    // The two ranks are separable: `#44` pins shortId 44, not every quest.
    const rows = [
      hit("quest", "Quest that says 44 in its title", 9),
      hit("folio", "Folio forty-four", 44),
    ];
    expect(titles(orderSearchHits(rows, "#44", 44, 10))[0]).toBe(
      "Folio forty-four",
    );
  });

  it("does not pin quests when the query is not an id", () => {
    const rows = [hit("folio", "alpha"), hit("quest", "zeta")];
    expect(titles(orderSearchHits(rows, "nomatch", undefined, 10))).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("caps the list at the limit", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      hit("folio", `folio ${i}`),
    );
    expect(orderSearchHits(rows, "folio", undefined, 12)).toHaveLength(12);
  });

  it("leaves the caller's array untouched", () => {
    const rows = [hit("folio", "zeta"), hit("folio", "alpha")];
    orderSearchHits(rows, "a", undefined, 10);
    expect(titles(rows)).toEqual(["zeta", "alpha"]);
  });
});
