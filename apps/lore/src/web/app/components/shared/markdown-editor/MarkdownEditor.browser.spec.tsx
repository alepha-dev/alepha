import { render as rtlRender, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import MarkdownEditorInner from "./MarkdownEditorInner.tsx";

/**
 * Edit mode mounts `MarkdownSelectionToolbar`, which is localized, so it
 * needs a container in context.
 *
 * Worth knowing: CodeMirror DOES construct under jsdom — it only fails to
 * MEASURE. So `onViewReady` fires here and the toolbar really does mount,
 * which is why this harness is required rather than optional.
 */
const render = (ui: ReactNode) =>
  rtlRender(
    <AlephaContext.Provider value={Alepha.create().with(AlephaLogger)}>
      {ui}
    </AlephaContext.Provider>,
  );

/**
 * `MarkdownEditorInner` rather than `MarkdownEditor`: the outer component is
 * a `React.lazy` boundary that renders a placeholder until its chunk
 * resolves, so a synchronous `render()` never gets past the placeholder.
 * That boundary is deliberate and load-bearing (CodeMirror is browser-only
 * and must not be evaluated during SSR), so the test goes under it rather
 * than around it.
 *
 * Edit mode is NOT asserted through a mounted CodeMirror — a view measures
 * layout on construction and jsdom cannot supply that. What is asserted is
 * the thing the toggle is responsible for: which face is showing.
 */
describe("MarkdownEditorInner mode toggle", () => {
  it("renders formatted markdown in view mode", () => {
    render(
      <MarkdownEditorInner value="# Hello" onChange={() => {}} mode="view" />,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hello");
  });

  it("defaults to view mode when no mode is given", () => {
    render(<MarkdownEditorInner value="# Hello" onChange={() => {}} />);

    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("renders no formatted output in edit mode", () => {
    const { container } = render(
      <MarkdownEditorInner value="# Hello" onChange={() => {}} mode="edit" />,
    );

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(container.querySelector(".lore-md-edit")).toBeTruthy();
  });

  it("renders viewContent, not value, in view mode", () => {
    // Regression guard. The folio workspace stores `[[Some Folio]]` and
    // `assets/x.webp` but must DISPLAY resolved links and `/api/files/<id>`
    // URLs — `rewriteFolioWikiLinks` does that, and its output arrives here
    // as `viewContent`. Rendering `value` instead shows the raw token as
    // literal text and every attachment as a broken image, which is exactly
    // what shipped for a moment while this prop did not exist.
    render(
      <MarkdownEditorInner
        value="[[Some Folio]]"
        viewContent="[Some Folio](/lore/folios/3)"
        onChange={() => {}}
        mode="view"
      />,
    );

    const link = screen.getByRole("link", { name: "Some Folio" });
    expect(link.getAttribute("href")).toBe("/lore/folios/3");
  });

  it("edits the raw value even when viewContent is supplied", () => {
    // The other half of the contract: the rewrite is a DISPLAY transform.
    // If Edit mode ever showed it, saving would persist resolved URLs and
    // destroy the portable `[[…]]` link graph on first keystroke.
    const { container } = render(
      <MarkdownEditorInner
        value="[[Some Folio]]"
        viewContent="[Some Folio](/lore/folios/3)"
        onChange={() => {}}
        mode="edit"
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector(".lore-md-edit")).toBeTruthy();
  });

  it("renders an empty document without crashing", () => {
    render(<MarkdownEditorInner value="" onChange={() => {}} mode="view" />);

    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("keeps the frame in the default variant and drops it when bare", () => {
    const { container: framed } = render(
      <MarkdownEditorInner value="x" onChange={() => {}} mode="view" />,
    );
    expect(framed.querySelector(".lore-md-view")?.className).toContain(
      "border",
    );

    const { container: bare } = render(
      <MarkdownEditorInner
        value="x"
        onChange={() => {}}
        mode="view"
        variant="bare"
      />,
    );
    expect(bare.querySelector(".lore-md-view")?.className).not.toContain(
      "border",
    );
  });
});
