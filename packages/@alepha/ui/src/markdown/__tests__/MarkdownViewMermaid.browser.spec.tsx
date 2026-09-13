import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "../markdown-view.tsx";

const fence = (language: string, body: string) =>
  ["```" + language, body, "```"].join("\n");

/**
 * The wiring, not the renderer: the three layers under `diagram/` have their
 * own specs. What is pinned here is that a mermaid fence is CLAIMED before
 * `rehype-highlight` sees it, that every way of failing lands back on the
 * grey code block, and that no other fence changed.
 */
describe("MarkdownView - mermaid fences", () => {
  it("renders a flowchart fence as an svg", async () => {
    const { container } = render(
      <MarkdownView
        content={fence("mermaid", "flowchart TD\n  A[Go] --> B")}
      />,
    );

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.textContent).toContain("Go");
  });

  it("keeps the prose and the fence area occupied on the first paint", () => {
    const { container } = render(
      <MarkdownView
        content={`# Title\n\n${fence("mermaid", "flowchart TD\n  A --> B")}`}
      />,
    );

    // Synchronously, before any chunk can have resolved. The Suspense
    // boundary is around the one fence, not the document, so the heading is
    // there; and its fallback IS the code block, so the fence area is
    // occupied by either the `pre` or the `svg` - never a spinner, never a
    // blank that would jump when the diagram arrives.
    //
    // Deliberately not asserting `pre` specifically: React's `lazy` caches
    // the module, so after the first render in a process the diagram is
    // there immediately, and pinning `pre` would make this pass or fail on
    // test ORDER rather than on behaviour.
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("pre, svg")).not.toBeNull();
  });

  it("falls back to the code block for a malformed diagram", async () => {
    const { container } = render(
      <MarkdownView content={fence("mermaid", "flowchart TD\n  ((((")} />,
    );

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a sequenceDiagram fence as an svg", async () => {
    const { container } = render(
      <MarkdownView
        content={fence("mermaid", "sequenceDiagram\n  A ->> B: hello")}
      />,
    );

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.textContent).toContain("hello");
  });

  it("dispatches on the header, not on what happens to parse", async () => {
    const { container } = render(
      <MarkdownView
        content={[
          fence("mermaid", "flowchart LR\n  A[Node] --> B"),
          fence("mermaid", "sequenceDiagram\n  A ->> B: msg"),
        ].join("\n\n")}
      />,
    );

    await waitFor(() =>
      expect(container.querySelectorAll("svg")).toHaveLength(2),
    );
    // The flowchart scales into the column and has no scroll frame; the
    // sequence diagram takes its natural width inside one.
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
    expect(container.textContent).toContain("Node");
    expect(container.textContent).toContain("msg");
  });

  it("falls back to the code block for a diagram type outside the subset", async () => {
    const { container } = render(
      <MarkdownView
        content={fence("mermaid", "classDiagram\n  Animal <|-- Duck")}
      />,
    );

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toContain("classDiagram");
  });

  it("falls back to the code block for a refused sequence construct", async () => {
    const { container } = render(
      <MarkdownView
        content={fence(
          "mermaid",
          "sequenceDiagram\n  par both at once\n    A ->> B: one\n  end",
        )}
      />,
    );

    // `par` refuses rather than drawing its branches one under the other,
    // which would assert an ordering that is false.
    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("svg")).toBeNull();
  });

  it("frames a sequence diagram so a wide one can be scrolled", async () => {
    const { container } = render(
      <MarkdownView
        content={fence("mermaid", "sequenceDiagram\n  A ->> B: hi")}
      />,
    );

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    const frame = container.querySelector('[role="region"]');
    // A scrollable region that cannot take focus cannot be scrolled from a
    // keyboard, so whatever is past the fold is simply unreachable.
    expect(frame?.getAttribute("tabindex")).toBe("0");
    expect(frame?.getAttribute("aria-label")).toBeTruthy();
    expect(frame?.className).toContain("alepha-diagram-scroll");
  });

  it("keeps the diagram source readable in the fallback", async () => {
    const { container } = render(
      <MarkdownView content={fence("mermaid", "gantt\n  title X")} />,
    );

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.textContent).toContain("title X");
  });

  it("leaves the mermaid fence unhighlighted", () => {
    const { container } = render(
      <MarkdownView content={fence("mermaid", "flowchart TD\n  A --> B")} />,
    );

    // `plainText: ["mermaid"]` - hljs must not tokenise the diagram source,
    // or the fallback is a soup of spans instead of the text the author wrote.
    expect(container.querySelector("code.hljs")).toBeNull();
  });

  it("still highlights an ordinary code fence", () => {
    const { container } = render(
      <MarkdownView content={fence("ts", "const a: number = 1;")} />,
    );

    const code = container.querySelector("pre code");
    expect(code?.className).toContain("language-ts");
    expect(container.querySelectorAll("pre code span").length).toBeGreaterThan(
      0,
    );
  });

  it("still renders a fence with no language as a plain code block", () => {
    const { container } = render(
      <MarkdownView content={fence("", "just text")} />,
    );

    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders prose around the diagram", async () => {
    const { container } = render(
      <MarkdownView
        content={`# Title\n\n${fence("mermaid", "flowchart TD\n  A --> B")}\n\nAfter.`}
      />,
    );

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Title");
    expect(container.textContent).toContain("After.");
  });

  it("renders two diagrams on one page", async () => {
    const { container } = render(
      <MarkdownView
        content={[
          fence("mermaid", "flowchart TD\n  A --> B"),
          fence("mermaid", "flowchart LR\n  C --> D"),
        ].join("\n\n")}
      />,
    );

    await waitFor(() =>
      expect(container.querySelectorAll("svg")).toHaveLength(2),
    );
  });

  it("falls back rather than laying out a graph past the cap", async () => {
    const huge = [
      "flowchart TD",
      ...Array.from({ length: 400 }, (_, i) => `  n${i} --> n${i + 1}`),
    ].join("\n");
    const { container } = render(
      <MarkdownView content={fence("mermaid", huge)} />,
    );

    await waitFor(() => expect(container.querySelector("pre")).not.toBeNull());
    expect(container.querySelector("svg")).toBeNull();
  });
});
