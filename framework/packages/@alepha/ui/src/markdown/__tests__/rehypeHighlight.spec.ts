import { describe, expect, it } from "vitest";

import { HIGHLIGHT_LANGUAGES, rehypeHighlight } from "../rehypeHighlight.ts";

/**
 * The plugin, run on the hast a fenced block becomes: `<pre><code
 * class="language-x">source</code></pre>`.
 */
describe("rehypeHighlight", () => {
  interface Node {
    type: string;
    tagName?: string;
    value?: string;
    properties?: { className?: unknown };
    children?: Node[];
  }

  const fence = (source: string, language?: string) => {
    const code: Node = {
      type: "element",
      tagName: "code",
      properties: language ? { className: [`language-${language}`] } : {},
      children: [{ type: "text", value: source }],
    };
    const tree: Node = {
      type: "root",
      children: [
        { type: "element", tagName: "pre", properties: {}, children: [code] },
      ],
    };
    return { tree, code };
  };

  const run = (
    tree: Node,
    options: Parameters<typeof rehypeHighlight>[0] = {},
  ) => {
    rehypeHighlight(options)(tree);
  };

  /**
   * Every `hljs-*` class the highlighter put on a span under this node.
   */
  const scopes = (node: Node): string[] =>
    (node.children ?? []).flatMap((child) => [
      ...(Array.isArray(child.properties?.className)
        ? (child.properties.className as string[]).filter((it) =>
            it.startsWith("hljs-"),
          )
        : []),
      ...scopes(child),
    ]);

  it("registers exactly the fifteen grammars Lore and the docs rely on", () => {
    expect(Object.keys(HIGHLIGHT_LANGUAGES).sort()).toEqual([
      "bash",
      "css",
      "diff",
      "dockerfile",
      "go",
      "ini",
      "javascript",
      "json",
      "markdown",
      "python",
      "rust",
      "sql",
      "typescript",
      "xml",
      "yaml",
    ]);
  });

  it("highlights a registered language", () => {
    const { tree, code } = fence("const answer: number = 42;", "typescript");
    run(tree);
    expect(scopes(code)).toContain("hljs-keyword");
    expect(code.properties?.className).toContain("hljs");
  });

  it.each([
    ["ts", "const a: string = 'x';"],
    ["tsx", "const a = <div className='x' />;"],
    ["sh", 'echo "$HOME" && exit 0'],
    ["html", '<div class="x">hi</div>'],
    ["yml", "name: alepha\nversion: 1"],
    ["jsonc", '{ "a": 1 }'],
  ])("highlights the %s alias", (alias, source) => {
    const { tree, code } = fence(source, alias);
    run(tree);
    expect(scopes(code).length).toBeGreaterThan(0);
  });

  it("renders a fence in an unregistered language as plain text, without throwing", () => {
    const { tree, code } = fence("IDENTIFICATION DIVISION.", "cobol");
    expect(() => run(tree, { detect: true })).not.toThrow();
    expect(code.children).toEqual([
      { type: "text", value: "IDENTIFICATION DIVISION." },
    ]);
    expect(scopes(code)).toEqual([]);
  });

  it("leaves a plainText language alone, class and text", () => {
    const source = "flowchart TD\n  a --> b";
    const { tree, code } = fence(source, "mermaid");
    run(tree, { detect: true, plainText: ["mermaid"] });
    expect(code.properties?.className).toEqual(["language-mermaid"]);
    expect(code.children).toEqual([{ type: "text", value: source }]);
  });

  it("detects the language of an unlabelled fence when asked to", () => {
    const { tree, code } = fence(
      "SELECT id, name FROM users WHERE id = 1 ORDER BY name;",
    );
    run(tree, { detect: true });
    const classes = (code.properties?.className ?? []) as string[];
    expect(classes).toContain("hljs");
    expect(classes.some((it) => it.startsWith("language-"))).toBe(true);
    expect(scopes(code).length).toBeGreaterThan(0);
  });

  it("leaves an unlabelled fence alone when detection is off", () => {
    const { tree, code } = fence("SELECT 1;");
    run(tree);
    expect(code.properties?.className).toBeUndefined();
    expect(scopes(code)).toEqual([]);
  });

  it("touches only code inside pre, never inline code", () => {
    const inline: Node = {
      type: "element",
      tagName: "code",
      properties: { className: ["language-ts"] },
      children: [{ type: "text", value: "const a = 1" }],
    };
    const tree: Node = {
      type: "root",
      children: [
        { type: "element", tagName: "p", properties: {}, children: [inline] },
      ],
    };
    run(tree, { detect: true });
    expect(inline.properties?.className).toEqual(["language-ts"]);
  });
});
