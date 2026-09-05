import { describe, expect, it } from "vitest";

import { rewriteFolioWikiLinks } from "../src/web/app/components/folios/rewriteFolioWikiLinks.ts";

const PROJECT_SLUG = "sds";

const folio = (shortId: number, title: string) =>
  ({
    id: `f-${shortId}`,
    shortId,
    title,
    content: "",
    tags: [],
    summary: "",
    directoryId: null,
    projectId: PROJECT_SLUG,
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    pinned: false,
    protected: false,
    searchText: "",
  }) as never;

/**
 * Broken-link markers (#107): a reference that resolves to nothing renders
 * as a link whose href carries the reason, never as prose. Since the purge
 * of epic #32 (quest #1808) a well-formed `#<LETTER><integer>` that misses
 * keeps its per-kind reason, and anything else between the brackets is
 * `not-a-reference`.
 */
describe("rewriteFolioWikiLinks — broken-link markers (#107)", () => {
  it("unresolved folio number → folio-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#F999]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [],
    );
    expect(out).toBe("See [\\[\\[#F999\\]\\]](#lore-broken:folio-not-found).");
  });

  it("[[#F156]] with no folio 156 but quest 156 → plain folio-not-found, no guess", () => {
    // The letter said "folio". Resolving across kinds would make a link's
    // destination depend on which folios happen to exist.
    const out = rewriteFolioWikiLinks(
      "See [[#F156]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [{ shortId: 156, title: "Some quest" }],
    );
    expect(out).toBe("See [\\[\\[#F156\\]\\]](#lore-broken:folio-not-found).");
  });

  it("unresolved quest number → quest-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[#Q999]].",
      PROJECT_SLUG,
      [],
      [{ shortId: 1, title: "Onboard" }],
    );
    expect(out).toBe("Cf. [\\[\\[#Q999\\]\\]](#lore-broken:quest-not-found).");
  });

  it("the legacy bare number is not a reference", () => {
    // `[[#156]]` used to mean folio 156. The kind is no longer guessed: the
    // token breaks visibly, whatever folios or quests exist.
    const out = rewriteFolioWikiLinks(
      "See [[#156]].",
      PROJECT_SLUG,
      [folio(156, "Roadmap")],
      [{ shortId: 156, title: "Some quest" }],
    );
    expect(out).toBe("See [\\[\\[#156\\]\\]](#lore-broken:not-a-reference).");
  });

  it("a title is not a reference, even one that names a folio", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[Roadmap]] and [[Nonexistent]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [],
    );
    expect(out).toBe(
      "Cf. [\\[\\[Roadmap\\]\\]](#lore-broken:not-a-reference) and [\\[\\[Nonexistent\\]\\]](#lore-broken:not-a-reference).",
    );
  });

  it("the prefixed, path and anchored forms are not references", () => {
    const out = rewriteFolioWikiLinks(
      "[[quest:#2]] [[epic:#3]] [[blob:#4]] [[specs/roadmap]] [[#F1#intro]]",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [{ shortId: 2, title: "Onboard" }],
      [],
      [{ shortId: 3, title: "Lore Deploy" }],
    );
    expect(out.match(/#lore-broken:not-a-reference/g)).toHaveLength(5);
    expect(out).not.toContain("/sds/");
  });

  it("resolved links are NOT rewritten with broken markers", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[#F1]] and [[#Q2]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [{ shortId: 2, title: "Onboard" }],
    );
    expect(out).not.toContain("lore-broken:");
    expect(out).toContain(`/${PROJECT_SLUG}/folios/1`);
    expect(out).toContain(`/${PROJECT_SLUG}/quests/2`);
  });

  it("empty token stays literal — not a wiki-link, not a broken marker", () => {
    const out = rewriteFolioWikiLinks("Cf. [[ ]].", PROJECT_SLUG, [], []);
    expect(out).toBe("Cf. [[ ]].");
  });
});

/**
 * Epics as a link target. `#E3` resolves against the epic's per-project
 * `number` — the field it is addressed by everywhere else — and the rewrite
 * emits a `/epics/:number` href, not a `/quests/` one.
 */
describe("rewriteFolioWikiLinks — epic targets", () => {
  const epics = [{ shortId: 3, title: "Lore Deploy" }];

  it("[[#E3]] → a link to the epic", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#E3]].",
      PROJECT_SLUG,
      [],
      [],
      [],
      epics,
    );
    expect(out).toBe("See [Lore Deploy](/sds/epics/3).");
  });

  it("an unknown epic gets its own broken reason, not the folio one", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#E99]].",
      PROJECT_SLUG,
      [],
      [],
      [],
      epics,
    );
    expect(out).toBe("See [\\[\\[#E99\\]\\]](#lore-broken:epic-not-found).");
  });
});

/**
 * The typed grammar of epic #32. The letter names the kind, so a miss is a
 * plain not-found for that kind and never a guess across kinds.
 */
describe("rewriteFolioWikiLinks — typed references", () => {
  it("[[#Q2]] → a link to the quest", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#Q2]].",
      PROJECT_SLUG,
      [],
      [{ shortId: 2, title: "Onboard" }],
    );
    expect(out).toBe("See [Onboard](/sds/quests/2).");
  });

  it("the letter is case-insensitive on the way in", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#q2]].",
      PROJECT_SLUG,
      [],
      [{ shortId: 2, title: "Onboard" }],
    );
    expect(out).toBe("See [Onboard](/sds/quests/2).");
  });

  it("[[#F1]] → a link to the folio", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#F1]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [],
    );
    expect(out).toBe("See [Roadmap](/sds/folios/1).");
  });
});

/**
 * Feedback and releases, the two kinds only the typed grammar can name
 * (epic #32, quest #1805). Feedback has no page of its own, so `#P` links
 * to the inbox naming the item; a release is addressed by number and
 * navigated by tag.
 */
describe("rewriteFolioWikiLinks — feedback and release targets", () => {
  const feedback = [{ shortId: 120, title: "Wrong colour", status: "pending" }];
  const releases = [
    { number: 12, title: "0.28.0", tag: "0.28.0" },
    { number: 13, title: "Untagged", tag: undefined },
  ];
  const rewrite = (content: string) =>
    rewriteFolioWikiLinks(
      content,
      PROJECT_SLUG,
      [],
      [],
      [],
      [],
      feedback,
      releases,
    );

  it("[[#P120]] → the inbox, naming the item", () => {
    expect(rewrite("See [[#P120]].")).toBe(
      "See [Wrong colour](/sds/feedback?feedback=120).",
    );
  });

  it("[[#P999]] → feedback-not-found", () => {
    expect(rewrite("See [[#P999]].")).toBe(
      "See [\\[\\[#P999\\]\\]](#lore-broken:feedback-not-found).",
    );
  });

  it("[[#R12]] → the release, by its tag", () => {
    expect(rewrite("See [[#R12]].")).toBe(
      "See [0.28.0](/sds/releases/0.28.0).",
    );
  });

  it("[[#R13]] with no tag → resolved, linking to the list", () => {
    expect(rewrite("See [[#R13]].")).toBe("See [Untagged](/sds/releases).");
  });

  it("[[#R999]] → release-not-found", () => {
    expect(rewrite("See [[#R999]].")).toBe(
      "See [\\[\\[#R999\\]\\]](#lore-broken:release-not-found).",
    );
  });
});
