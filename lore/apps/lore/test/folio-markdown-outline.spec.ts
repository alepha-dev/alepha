import { describe, expect, it } from "vitest";
import { markdownOutline } from "@/web/app/components/folios/editor/inspector/markdownOutline.ts";

describe("markdownOutline", () => {
  it("returns an empty list for content without headings", () => {
    expect(markdownOutline("just a paragraph\n\nand another")).toEqual([]);
  });

  it("extracts ATX headings with their level and text", () => {
    const result = markdownOutline("# Title\n\ntext\n\n## Section\n\n### Deep");
    expect(result).toEqual([
      { level: 1, text: "Title", index: 0 },
      { level: 2, text: "Section", index: 1 },
      { level: 3, text: "Deep", index: 2 },
    ]);
  });

  it("ignores '#' lines inside fenced code blocks", () => {
    const md = [
      "# Real",
      "",
      "```bash",
      "# not a heading",
      "echo hi",
      "```",
      "",
      "## Also real",
    ].join("\n");
    expect(markdownOutline(md)).toEqual([
      { level: 1, text: "Real", index: 0 },
      { level: 2, text: "Also real", index: 1 },
    ]);
  });

  it("handles tilde fences and fences with an info string", () => {
    const md = ["~~~ts", "# nope", "~~~", "# yes"].join("\n");
    expect(markdownOutline(md)).toEqual([{ level: 1, text: "yes", index: 0 }]);
  });

  it("strips inline markdown from heading text", () => {
    const result = markdownOutline("## Why `directories`, not **nesting**");
    expect(result[0].text).toBe("Why directories, not nesting");
  });

  it("supports setext headings", () => {
    const result = markdownOutline("Title\n=====\n\nSection\n-------");
    expect(result).toEqual([
      { level: 1, text: "Title", index: 0 },
      { level: 2, text: "Section", index: 1 },
    ]);
  });

  it("ignores a '#' with no space after it", () => {
    expect(markdownOutline("#hashtag not a heading")).toEqual([]);
  });

  it("caps the level at 6", () => {
    expect(markdownOutline("####### seven")).toEqual([]);
  });

  it("does not close a fence with a shorter run of the same marker", () => {
    const md = [
      "````markdown",
      "# not a heading",
      "```",
      "## also not a heading",
      "````",
      "",
      "# real",
    ].join("\n");
    expect(markdownOutline(md)).toEqual([{ level: 1, text: "real", index: 0 }]);
  });

  it("closes a fence with a longer run of the same marker", () => {
    const md = ["```", "# not a heading", "`````", "", "# real"].join("\n");
    expect(markdownOutline(md)).toEqual([{ level: 1, text: "real", index: 0 }]);
  });

  it("leaves intra-word underscores alone", () => {
    const result = markdownOutline("## LOG_FORMAT and LOG_LEVEL");
    expect(result[0].text).toBe("LOG_FORMAT and LOG_LEVEL");
  });

  it("preserves the contents of a code span", () => {
    const result = markdownOutline("## Use `a*b*c` for globbing");
    expect(result[0].text).toBe("Use a*b*c for globbing");
  });

  it("still strips real emphasis around whole words", () => {
    const result = markdownOutline("## Why _directories_, not **nesting**");
    expect(result[0].text).toBe("Why directories, not nesting");
  });
});
