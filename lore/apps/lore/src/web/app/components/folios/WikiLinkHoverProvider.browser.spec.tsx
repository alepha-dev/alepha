import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { render } from "@testing-library/react";
import { describe, it } from "vitest";

import { BROKEN_HREF_PREFIX } from "./folioWikiLinkResolver.ts";

/**
 * The broken-link path is only as real as the href that carries it, and that
 * href has to survive react-markdown.
 *
 * `BROKEN_HREF_PREFIX` was a bare `lore-broken:` scheme, which
 * `defaultUrlTransform` drops: every broken wiki-link reached the DOM as
 * `href=""`, so `parseHref` never produced a `broken` target, the hover card
 * branch never rendered, the wavy red underline never matched, and the
 * localised reason strings in both catalogues were unreachable. The whole
 * feature was inert and looked implemented.
 *
 * These cases pin the two halves that keep it alive: the prefix stays a
 * fragment (relative, so the transform keeps it verbatim), and the marker
 * the styling keys on is what actually lands in the DOM.
 */
describe("broken wiki-link hrefs survive the markdown renderer", () => {
  const hrefOf = (markdown: string): string | null | undefined =>
    render(<MarkdownView content={markdown} />)
      .container.querySelector("a")
      ?.getAttribute("href");

  it("keeps a broken href intact, reason and all", ({ expect }) => {
    const href = `${BROKEN_HREF_PREFIX}folio-not-found`;
    expect(hrefOf(`[[[Missing]]](${href})`)).toBe(href);
  });

  it("is a fragment, which is why the transform keeps it", ({ expect }) => {
    // The regression this file exists for: a bare `lore-broken:` reads as a
    // scheme, and every scheme outside the transform's safe list is dropped.
    expect(BROKEN_HREF_PREFIX.startsWith("#")).toBe(true);
    expect(hrefOf("[Label](lore-broken:folio-not-found)")).toBe("");
  });

  it("still strips a genuinely dangerous scheme", ({ expect }) => {
    // The fragment is a way past the transform for one prefix, not a way of
    // turning it off.
    expect(hrefOf("[Label](javascript:alert(1))")).toBe("");
  });
});
