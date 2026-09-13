import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "../markdown-view.tsx";

/**
 * `||spoiler||`, and the ten cases the plugin was prototyped against.
 *
 * The interesting half is what must NOT become a spoiler: a table's pipes, a
 * code span, a fence, and an unterminated marker. The naive implementation -
 * split one text node on `/\|\|([\s\S]+?)\|\|/` - passes every case here
 * except one, "inline markdown inside the spoiler", because once emphasis has
 * split the paragraph the opening marker and its closer live in different
 * mdast siblings. That case is the reason the plugin walks siblings.
 */
const hidden = (container: HTMLElement) => [
  ...container.querySelectorAll('[data-spoiler="hidden"]'),
];

const covered = (container: HTMLElement) =>
  hidden(container).map((node) => node.textContent);

describe("MarkdownView - spoilers", () => {
  it("wraps only the marked words, leaving the rest of the line alone", () => {
    const { container } = render(
      <MarkdownView content="a ||so secret password|| b" />,
    );

    expect(covered(container)).toEqual(["so secret password"]);
    expect(container.textContent).toBe("a so secret password b");
  });

  it("keeps inline markdown inside the spoiler", () => {
    const { container } = render(
      <MarkdownView content="||a **bold** word||" />,
    );

    const box = hidden(container)[0];
    expect(box?.textContent).toBe("a bold word");
    expect(box?.querySelector("strong")?.textContent).toBe("bold");
  });

  it("keeps a link inside the spoiler", () => {
    const { container } = render(
      <MarkdownView content="||see [docs](/d) now||" />,
    );

    const box = hidden(container)[0];
    expect(box?.textContent).toBe("see docs now");
    expect(box?.querySelector("a")?.getAttribute("href")).toBe("/d");
  });

  /**
   * ⚠️ The pipes of a GFM table are the case that would break every document
   * in the app at once. They survive because `remarkGfm` runs first: by the
   * time the spoiler walk sees the tree, `| a | b |` is a row with cells and
   * the pipes are structure rather than text.
   */
  it("leaves a GFM table's pipes alone", () => {
    const { container } = render(
      <MarkdownView content={"| a | b |\n| - | - |\n| 1 | 2 |"} />,
    );

    expect(hidden(container)).toHaveLength(0);
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("keeps a code span literal", () => {
    const { container } = render(<MarkdownView content="a `||x||` b" />);

    expect(hidden(container)).toHaveLength(0);
    expect(container.querySelector("code")?.textContent).toBe("||x||");
  });

  it("keeps a fenced block literal", () => {
    const { container } = render(
      <MarkdownView content={"```\n||nope||\n```"} />,
    );

    expect(hidden(container)).toHaveLength(0);
    expect(container.querySelector("pre")?.textContent).toContain("||nope||");
  });

  it("covers two spoilers on one line, independently", () => {
    const { container } = render(
      <MarkdownView content="||one|| between ||two||" />,
    );

    expect(covered(container)).toEqual(["one", "two"]);
    expect(container.textContent).toBe("one between two");
  });

  it("works inside a heading and inside a list item", () => {
    const { container } = render(
      <MarkdownView content={"# a ||b|| c\n\n- d ||e|| f"} />,
    );

    expect(container.querySelector("h1")?.textContent).toBe("a b c");
    expect(container.querySelector("li")?.textContent).toBe("d e f");
    expect(covered(container)).toEqual(["b", "e"]);
  });

  /**
   * The failure mode a lazy regex has and a reader cannot explain: the rest
   * of the paragraph disappears behind a box that was never closed.
   */
  it("renders an unterminated marker literally", () => {
    const { container } = render(
      <MarkdownView content="a ||b and then some more text" />,
    );

    expect(hidden(container)).toHaveLength(0);
    expect(container.textContent).toBe("a ||b and then some more text");
  });

  it("does not let a pair cross a paragraph break", () => {
    const { container } = render(<MarkdownView content={"a ||b\n\nc|| d"} />);

    expect(hidden(container)).toHaveLength(0);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("reveals on click, and stays revealed", () => {
    const { container } = render(<MarkdownView content="a ||secret|| b" />);

    fireEvent.click(hidden(container)[0]!);

    expect(hidden(container)).toHaveLength(0);
    const shown = container.querySelector('[data-spoiler="revealed"]');
    expect(shown?.textContent).toBe("secret");
  });

  it.each(["Enter", " "])("reveals on %s", (key) => {
    const { container } = render(<MarkdownView content="a ||secret|| b" />);

    fireEvent.keyDown(hidden(container)[0]!, { key });

    expect(hidden(container)).toHaveLength(0);
    expect(
      container.querySelector('[data-spoiler="revealed"]')?.textContent,
    ).toBe("secret");
  });

  it("is announced as something a reader has to activate", () => {
    const { container } = render(<MarkdownView content="a ||secret|| b" />);

    const box = hidden(container)[0]!;
    expect(box.getAttribute("role")).toBe("button");
    expect(box.getAttribute("tabindex")).toBe("0");
    expect(box.getAttribute("aria-expanded")).toBe("false");
    expect(box.getAttribute("aria-label")).toBeTruthy();
  });

  /**
   * ⚠️ Pinned deliberately, because it is the thing the feature must never be
   * mistaken for: the text is in the DOM from the first paint. Anything that
   * made this assertion fail - rendering the covered text as dots, dropping
   * it until revealed - would be a change of contract, not a fix.
   */
  it("has the covered text in the DOM before it is revealed", () => {
    const { container } = render(<MarkdownView content="a ||secret|| b" />);

    expect(container.textContent).toContain("secret");
  });
});
