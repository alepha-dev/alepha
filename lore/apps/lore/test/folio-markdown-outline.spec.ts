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
});
