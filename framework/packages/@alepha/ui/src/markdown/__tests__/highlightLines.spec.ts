import { describe, it } from "vitest";

import { highlightLanguageOf, highlightLines } from "../highlightLines.ts";

describe("highlightLines", () => {
  it("answers one entry per line, a multi-line comment classed on every line", ({
    expect,
  }) => {
    const lines = highlightLines(
      "const a = 1;\n/* one\ntwo */\nlet b = `x\ny`;\n",
      "typescript",
    );
    expect(lines).toHaveLength(6);
    expect(lines[0]?.[0]).toEqual({
      value: "const",
      className: "hljs-keyword",
    });
    expect(lines[1]).toEqual([{ value: "/* one", className: "hljs-comment" }]);
    expect(lines[2]).toEqual([{ value: "two */", className: "hljs-comment" }]);
    expect(lines[4]?.find((it) => it.value.includes("y`"))?.className).toBe(
      "hljs-string",
    );
    expect(lines[5]).toEqual([]);
    expect(
      lines.map((line) => line.map((it) => it.value).join("")).join("\n"),
    ).toBe("const a = 1;\n/* one\ntwo */\nlet b = `x\ny`;\n");
  });

  it("answers plain lines for an unknown language or none", ({ expect }) => {
    expect(highlightLines("a\n\nb", "cobol")).toEqual([
      [{ value: "a" }],
      [],
      [{ value: "b" }],
    ]);
    expect(highlightLines("a", undefined)).toEqual([[{ value: "a" }]]);
  });

  it("names a grammar from a path", ({ expect }) => {
    expect(highlightLanguageOf("src/app.tsx")).toBe("typescript");
    expect(highlightLanguageOf("deploy/Dockerfile")).toBe("dockerfile");
    expect(highlightLanguageOf("README.md")).toBe("markdown");
    expect(highlightLanguageOf("bin/tool")).toBeUndefined();
    expect(highlightLanguageOf("image.png")).toBeUndefined();
  });
});
