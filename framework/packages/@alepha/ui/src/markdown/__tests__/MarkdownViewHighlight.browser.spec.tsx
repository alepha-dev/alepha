import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "../MarkdownView.tsx";

/**
 * The highlighter as `MarkdownView` wires it: the grammar list and its edge
 * cases are pinned in `rehypeHighlight.spec.ts`, these pin that the view runs
 * the plugin at all, and with detection on.
 */
describe("MarkdownView code highlighting", () => {
  it("colours a fence in a registered language", () => {
    const { container } = render(
      <MarkdownView content={"```ts\nconst answer: number = 42;\n```"} />,
    );

    expect(
      container.querySelector("pre code.hljs .hljs-keyword"),
    ).not.toBeNull();
  });

  it("renders a fence in any other language as its plain text", () => {
    const { container } = render(
      <MarkdownView content={"```cobol\nIDENTIFICATION DIVISION.\n```"} />,
    );

    const code = container.querySelector("pre code");
    expect(code?.textContent).toBe("IDENTIFICATION DIVISION.\n");
    expect(code?.querySelector("[class^='hljs-']")).toBeNull();
  });

  it("detects the language of a fence that names none", () => {
    const { container } = render(
      <MarkdownView
        content={"```\nSELECT id, name FROM users WHERE id = 1;\n```"}
      />,
    );

    const code = container.querySelector("pre code");
    expect(code?.className).toMatch(/language-/);
    expect(code?.querySelector("[class^='hljs-']")).not.toBeNull();
  });
});
