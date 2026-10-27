import { Alepha } from "alepha";
import { AlephaOrm } from "alepha/orm";
import { describe, it } from "vitest";

import { ProjectMergeReferences } from "../src/api/services/ProjectMergeReferences.ts";

/**
 * The text half of a project merge (#E94, #Q2783): a reference to a
 * renumbered item follows it, and nothing else moves.
 */
describe("ProjectMergeReferences", () => {
  const references = Alepha.create({ env: { DATABASE_URL: ":memory:" } })
    .with(AlephaOrm)
    .inject(ProjectMergeReferences);
  const rewriter = (slugs: { sourceSlug?: string; targetSlug?: string } = {}) =>
    references.rewriter({
      renumbered: [
        { kind: "quest", id: 1, from: 2683, to: 2790 },
        { kind: "epic", id: 2, from: 73, to: 95 },
        { kind: "directory", id: "d", from: 4, to: 9 },
      ],
      ...slugs,
    });

  it("rewrites a typed reference to a renumbered item, and leaves the others", ({
    expect,
  }) => {
    expect(
      rewriter().text("See [[#Q2683]], [[#E73]], [[#q2683]] and [[#Q2684]]."),
    ).toBe("See [[#Q2790]], [[#E95]], [[#q2790]] and [[#Q2684]].");
  });

  it("leaves code spans and fences alone", ({ expect }) => {
    const text =
      "Real [[#Q2683]], quoted `[[#Q2683]]`.\n\n```\n[[#Q2683]]\n```\n";
    expect(rewriter().text(text)).toBe(
      "Real [[#Q2790]], quoted `[[#Q2683]]`.\n\n```\n[[#Q2683]]\n```\n",
    );
  });

  it("does not touch a longer number that starts with a renumbered one", ({
    expect,
  }) => {
    expect(rewriter().text("[[#Q26830]] [[#E730]]")).toBe(
      "[[#Q26830]] [[#E730]]",
    );
  });

  it("rewrites a Lore URL of the source project to the target's slug and number", ({
    expect,
  }) => {
    const text = [
      "https://lore.alepha.dev/lore/quests/2683",
      "https://lore.alepha.dev/lore/quests/12",
      "https://lore.alepha.dev/lore/folios",
      "(https://lore.alepha.dev/lore)",
      "https://lore.alepha.dev/lorem/quests/2683",
      "https://github.com/alepha-dev/lore/pull/3",
    ].join("\n");

    expect(
      rewriter({ sourceSlug: "lore", targetSlug: "alepha" }).text(text),
    ).toBe(
      [
        "https://lore.alepha.dev/alepha/quests/2790",
        "https://lore.alepha.dev/alepha/quests/12",
        "https://lore.alepha.dev/alepha/folios",
        "(https://lore.alepha.dev/alepha)",
        "https://lore.alepha.dev/lorem/quests/2683",
        "https://github.com/alepha-dev/lore/pull/3",
      ].join("\n"),
    );
  });

  it("is empty when nothing was renumbered and the slug stays", ({
    expect,
  }) => {
    const empty = references.rewriter({
      renumbered: [],
      sourceSlug: "a",
      targetSlug: "a",
    });

    expect(empty.empty).toBe(true);
    expect(empty.text("[[#Q1]]")).toBe("[[#Q1]]");
  });
});
