import { describe, expect, it } from "vitest";
import { splitMarkdownCode } from "../src/web/app/components/folios/markdownCodeSegments.ts";
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

const rewrite = (content: string) =>
  rewriteFolioWikiLinks(
    content,
    PROJECT_SLUG,
    [folio(1, "Roadmap")],
    [{ shortId: 1, title: "A quest" }],
  );

describe("splitMarkdownCode", () => {
  it("marks a backtick fence, its content and its terminator as code", () => {
    const segments = splitMarkdownCode("a\n```\nb\n```\nc");
    expect(segments.map((s) => [s.text, s.code])).toEqual([
      ["a\n", false],
      ["```\nb\n```\n", true],
      ["c", false],
    ]);
  });

  it("keeps a tilde fence closed by tildes only", () => {
    const segments = splitMarkdownCode("~~~\n```\n~~~\nx");
    expect(segments[0]).toEqual({ text: "~~~\n```\n~~~\n", code: true });
    expect(segments[1]).toEqual({ text: "x", code: false });
  });

  it("needs a closing run at least as long as the opening one", () => {
    const segments = splitMarkdownCode("````\n```\nstill code\n````\nout");
    expect(segments[0].code).toBe(true);
    expect(segments[0].text).toContain("still code");
    expect(segments[1]).toEqual({ text: "out", code: false });
  });

  it("recognises a fence indented inside a list item", () => {
    const segments = splitMarkdownCode("- item\n  ```\n  code\n  ```\n- next");
    expect(segments[1]).toEqual({ text: "  ```\n  code\n  ```\n", code: true });
  });

  it("marks an inline code span as code", () => {
    const segments = splitMarkdownCode("see `a` here");
    expect(segments.map((s) => [s.text, s.code])).toEqual([
      ["see ", false],
      ["`a`", true],
      [" here", false],
    ]);
  });

  it("closes a multi-backtick span only on a run of the same length", () => {
    const segments = splitMarkdownCode("``a ` b`` tail");
    expect(segments[0]).toEqual({ text: "``a ` b``", code: true });
    expect(segments[1]).toEqual({ text: " tail", code: false });
  });

  it("treats an unterminated backtick run as prose", () => {
    const segments = splitMarkdownCode("a ` b");
    expect(segments).toEqual([{ text: "a ` b", code: false }]);
  });

  it("leaves an unterminated fence open to the end of the document", () => {
    const segments = splitMarkdownCode("x\n```\nnever closed");
    expect(segments).toEqual([
      { text: "x\n", code: false },
      { text: "```\nnever closed", code: true },
    ]);
  });

  it("round-trips the input exactly", () => {
    const input = "a `b` c\n\n```ts\nconst x = [[1, 2]];\n```\n\ntail\n";
    expect(
      splitMarkdownCode(input)
        .map((s) => s.text)
        .join(""),
    ).toBe(input);
  });
});

describe("rewriteFolioWikiLinks - fenced code is untouched (#1261)", () => {
  it("leaves [[...]] inside a fenced block alone", () => {
    const input = "See [[#1]].\n\n```ts\nconst a = [[1, 2]];\n```\n";
    expect(rewrite(input)).toBe(
      "See [Roadmap](/sds/folios/1).\n\n```ts\nconst a = [[1, 2]];\n```\n",
    );
  });

  it("leaves a mermaid subroutine shape alone", () => {
    const input = "```mermaid\nflowchart TD\n  A[[Sub]] --> B\n```";
    expect(rewrite(input)).toBe(input);
  });

  it("leaves an assets/ reference inside a fence alone", () => {
    const input = "```md\n![a](assets/b.webp)\n```";
    expect(rewrite(input)).toBe(input);
  });

  it("leaves a blob: embed inside a fence alone", () => {
    const input = "```md\n![a](blob:#3)\n```";
    expect(rewrite(input)).toBe(input);
  });

  it("leaves [[...]] inside an inline code span alone", () => {
    expect(rewrite("write `[[#1]]` to link")).toBe("write `[[#1]]` to link");
  });

  it("still rewrites prose on the same line as an inline code span", () => {
    expect(rewrite("`[[#1]]` renders [[#1]]")).toBe(
      "`[[#1]]` renders [Roadmap](/sds/folios/1)",
    );
  });
});
