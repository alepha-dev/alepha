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

describe("rewriteFolioWikiLinks — broken-link markers (#107)", () => {
  it("unresolved folio shortId → folio-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#999]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [],
    );
    expect(out).toBe("See [\\[\\[#999\\]\\]](#lore-broken:folio-not-found).");
  });

  it("[[#N]] with no folio N but a quest N → names the quest form (#192)", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#156]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [{ shortId: 156, title: "Some quest" }],
    );
    // Still broken on purpose — resolving it to the quest would make a link's
    // destination depend on which folios happen to exist. The shortId rides
    // along so the hover card can name `[[quest:#156]]`.
    expect(out).toBe(
      "See [\\[\\[#156\\]\\]](#lore-broken:folio-not-found-quest-exists:156).",
    );
  });

  it("[[#N]] with neither a folio nor a quest N → plain folio-not-found", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#156]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [{ shortId: 7, title: "Unrelated" }],
    );
    expect(out).toBe("See [\\[\\[#156\\]\\]](#lore-broken:folio-not-found).");
  });

  it("an unresolved TITLE never suggests a quest — the namespaces are unrelated", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[Some quest]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [{ shortId: 156, title: "Some quest" }],
    );
    expect(out).toBe(
      "Cf. [\\[\\[Some quest\\]\\]](#lore-broken:folio-not-found).",
    );
  });

  it("unresolved folio title → folio-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[Nonexistent]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [],
    );
    expect(out).toBe(
      "Cf. [\\[\\[Nonexistent\\]\\]](#lore-broken:folio-not-found).",
    );
  });

  it("ambiguous folio title → ambiguous-title marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[Notes]].",
      PROJECT_SLUG,
      [folio(1, "Notes"), folio(2, "Notes")],
      [],
    );
    expect(out).toBe("Cf. [\\[\\[Notes\\]\\]](#lore-broken:ambiguous-title).");
  });

  it("unresolved quest shortId → quest-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[quest:#999]].",
      PROJECT_SLUG,
      [],
      [{ shortId: 1, title: "Onboard" }],
    );
    expect(out).toBe(
      "Cf. [\\[\\[quest:#999\\]\\]](#lore-broken:quest-not-found).",
    );
  });

  it("ambiguous quest title → ambiguous-title marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[quest:Fix]].",
      PROJECT_SLUG,
      [],
      [
        { shortId: 1, title: "Fix" },
        { shortId: 2, title: "Fix" },
      ],
    );
    expect(out).toBe(
      "Cf. [\\[\\[quest:Fix\\]\\]](#lore-broken:ambiguous-title).",
    );
  });

  it("unresolved blob shortId → blob-not-found marker", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[blob:#999]].",
      PROJECT_SLUG,
      [],
      [],
      [],
      [],
    );
    expect(out).toBe(
      "Cf. [\\[\\[blob:#999\\]\\]](#lore-broken:blob-not-found).",
    );
  });

  it("resolved links are NOT rewritten with broken markers", () => {
    const out = rewriteFolioWikiLinks(
      "Cf. [[#1]] and [[quest:#2]].",
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
 * Epics as a link target. The `epic:` prefix resolves against the epic's
 * per-project `number` — the field it is addressed by everywhere else — and
 * the rewrite emits a `/epics/:number` href, not a `/quests/` one.
 */
describe("rewriteFolioWikiLinks — epic targets", () => {
  const epics = [{ shortId: 3, title: "Lore Deploy" }];

  it("[[epic:#3]] → a link to the epic", () => {
    const out = rewriteFolioWikiLinks(
      "See [[epic:#3]].",
      PROJECT_SLUG,
      [],
      [],
      [],
      [],
      epics,
    );
    expect(out).toBe("See [Lore Deploy](/sds/epics/3).");
  });

  it("[[epic:Title]] resolves by title when unique", () => {
    const out = rewriteFolioWikiLinks(
      "See [[epic:Lore Deploy]].",
      PROJECT_SLUG,
      [],
      [],
      [],
      [],
      epics,
    );
    expect(out).toBe("See [Lore Deploy](/sds/epics/3).");
  });

  it("an unknown epic gets its own broken reason, not the folio one", () => {
    const out = rewriteFolioWikiLinks(
      "See [[epic:#99]].",
      PROJECT_SLUG,
      [],
      [],
      [],
      [],
      epics,
    );
    expect(out).toBe(
      "See [\\[\\[epic:#99\\]\\]](#lore-broken:epic-not-found).",
    );
  });

  it("a bare [[#3]] stays a FOLIO ref even when epic 3 exists", () => {
    // Same rule the quest form follows: inferring across kinds would make a
    // link's destination depend on which folios happen to exist.
    const out = rewriteFolioWikiLinks(
      "See [[#3]].",
      PROJECT_SLUG,
      [],
      [],
      [],
      [],
      epics,
    );
    expect(out).toBe("See [\\[\\[#3\\]\\]](#lore-broken:folio-not-found).");
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

  it("[[#E3]] → a link to the epic", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#E3]].",
      PROJECT_SLUG,
      [],
      [],
      [],
      [],
      [{ shortId: 3, title: "Lore Deploy" }],
    );
    expect(out).toBe("See [Lore Deploy](/sds/epics/3).");
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

  it("[[#Q999]] with no such quest → quest-not-found", () => {
    const out = rewriteFolioWikiLinks(
      "See [[#Q999]].",
      PROJECT_SLUG,
      [],
      [{ shortId: 2, title: "Onboard" }],
    );
    expect(out).toBe("See [\\[\\[#Q999\\]\\]](#lore-broken:quest-not-found).");
  });

  it("[[#F156]] with no folio 156 but quest 156 → plain folio-not-found, no hint", () => {
    // The `folio-not-found-quest-exists` diagnosis exists for the legacy bare
    // `[[#156]]`, where the kind was a guess. `#F156` said "folio".
    const out = rewriteFolioWikiLinks(
      "See [[#F156]].",
      PROJECT_SLUG,
      [folio(1, "Roadmap")],
      [{ shortId: 156, title: "Some quest" }],
    );
    expect(out).toBe("See [\\[\\[#F156\\]\\]](#lore-broken:folio-not-found).");
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
