import { describe, expect, it } from "vitest";
import { rewriteFolioWikiLinks } from "../src/web/app/components/folios/rewriteFolioWikiLinks.ts";

const PROJECT_ID = 1;

const folio = (shortId: number, title: string) =>
  ({
    id: `f-${shortId}`,
    shortId,
    title,
    content: "",
    tags: [],
    summary: "",
    directoryId: null,
    projectId: PROJECT_ID,
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    pinned: false,
    protected: false,
    searchText: "",
  }) as never;

describe("rewriteFolioWikiLinks — broken-link markers (#107)", () => {
  it("unresolved folio shortId → folio-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#999]].",
      PROJECT_ID,
      [folio(1, "Roadmap")],
      [],
    );
    expect(out).toBe("See [\\[\\[#999\\]\\]](lore-broken:folio-not-found).");
  });

  it("unresolved folio title → folio-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[Nonexistent]].",
      PROJECT_ID,
      [folio(1, "Roadmap")],
      [],
    );
    expect(out).toBe(
      "Cf. [\\[\\[Nonexistent\\]\\]](lore-broken:folio-not-found).",
    );
  });

  it("ambiguous folio title → ambiguous-title marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[Notes]].",
      PROJECT_ID,
      [folio(1, "Notes"), folio(2, "Notes")],
      [],
    );
    expect(out).toBe("Cf. [\\[\\[Notes\\]\\]](lore-broken:ambiguous-title).");
  });

  it("unresolved quest shortId → quest-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[quest:#999]].",
      PROJECT_ID,
      [],
      [{ shortId: 1, title: "Onboard" }],
    );
    expect(out).toBe(
      "Cf. [\\[\\[quest:#999\\]\\]](lore-broken:quest-not-found).",
    );
  });

  it("ambiguous quest title → ambiguous-title marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[quest:Fix]].",
      PROJECT_ID,
      [],
      [
        { shortId: 1, title: "Fix" },
        { shortId: 2, title: "Fix" },
      ],
    );
    expect(out).toBe(
      "Cf. [\\[\\[quest:Fix\\]\\]](lore-broken:ambiguous-title).",
    );
  });

  it("unresolved blob shortId → blob-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[blob:#999]].",
      PROJECT_ID,
      [],
      [],
      [],
      [],
    );
    expect(out).toBe(
      "Cf. [\\[\\[blob:#999\\]\\]](lore-broken:blob-not-found).",
    );
  });

  it("resolved links are NOT rewritten with broken markers", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[#1]] and [[quest:#2]].",
      PROJECT_ID,
      [folio(1, "Roadmap")],
      [{ shortId: 2, title: "Onboard" }],
    );
    expect(out).not.toContain("lore-broken:");
    expect(out).toContain("/p/1/folios/1");
    expect(out).toContain("/p/1/q/2");
  });

  it("empty token stays literal — not a wiki-link, not a broken marker", () => {
    const out = rewriteFolioWikiLinks("Cf. [[ ]].", PROJECT_ID, [], []);
    expect(out).toBe("Cf. [[ ]].");
  });
});
