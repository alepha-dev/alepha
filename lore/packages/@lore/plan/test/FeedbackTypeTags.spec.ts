import { describe, it } from "vitest";

import { FeedbackTypeTags } from "../src/api/services/FeedbackTypeTags.ts";

describe("FeedbackTypeTags (#Q4037)", () => {
  it("tags an Idea as feature, the embed's spelling", ({ expect }) => {
    expect(FeedbackTypeTags.tagOf("idea")).toBe("feature");
    expect(FeedbackTypeTags.tagOf("bug")).toBe("bug");
    expect(FeedbackTypeTags.tagOf("question")).toBe("question");
    expect(FeedbackTypeTags.tagOf("other")).toBe("other");
  });

  it("reads the type a ?type= already put in the tags", ({ expect }) => {
    expect(FeedbackTypeTags.typeOf(["feature", "ui"])).toBe("idea");
    expect(FeedbackTypeTags.typeOf(["ui", "bug"])).toBe("bug");
    expect(FeedbackTypeTags.typeOf(["ui"])).toBeUndefined();
  });

  it("puts the chosen type first, once, replacing another type tag", ({
    expect,
  }) => {
    expect(FeedbackTypeTags.fold(["bug", "ui"], "bug")).toEqual(["bug", "ui"]);
    expect(FeedbackTypeTags.fold(["feature", "ui"], "bug")).toEqual([
      "bug",
      "ui",
    ]);
    expect(FeedbackTypeTags.fold([], "question")).toEqual(["question"]);
  });

  it("counts the type within the 20-tag cap", ({ expect }) => {
    const many = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const folded = FeedbackTypeTags.fold(many, "other");
    expect(folded).toHaveLength(20);
    expect(folded[0]).toBe("other");
  });
});
