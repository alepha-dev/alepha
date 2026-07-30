import { describe, expect, it } from "vitest";
import { normalizeEditorMarkdown } from "../src/web/app/components/shared/markdown-editor/normalizeEditorMarkdown.ts";

/**
 * The WYSIWYG editor (MDXEditor/Lexical) escapes brackets when it
 * serializes back to markdown, which would break Lore wiki-links and
 * silently drop the campaign link graph on the next folio save. The
 * normalizer must repair every escaping combination the editor emits,
 * and must never touch anything else.
 */
describe("normalizeEditorMarkdown", () => {
  it("repairs fully-escaped wiki-links", () => {
    expect(normalizeEditorMarkdown("see \\[\\[Folio Title]]")).toBe(
      "see [[Folio Title]]",
    );
    expect(normalizeEditorMarkdown("\\[\\[Folio Title\\]\\]")).toBe(
      "[[Folio Title]]",
    );
  });

  it("repairs partially-escaped wiki-links", () => {
    expect(normalizeEditorMarkdown("[\\[#12]]")).toBe("[[#12]]");
    expect(normalizeEditorMarkdown("\\[[quest#5]]")).toBe("[[quest#5]]");
  });

  it("keeps already-clean wiki-links untouched", () => {
    const text = "linking [[Folio Title]] and [[#12]] and [[quest#5]]";
    expect(normalizeEditorMarkdown(text)).toBe(text);
  });

  it("leaves regular markdown links and images alone", () => {
    const text = "[label](https://example.com) and ![alt](/api/files/abc)";
    expect(normalizeEditorMarkdown(text)).toBe(text);
  });

  it("leaves single escaped brackets alone", () => {
    // A lone escaped bracket is legitimate markdown escaping — only the
    // double-bracket wiki-link form is Lore syntax.
    const text = "array\\[0] notation";
    expect(normalizeEditorMarkdown(text)).toBe(text);
  });

  it("handles multiple wiki-links on one line", () => {
    expect(normalizeEditorMarkdown("\\[\\[A]] then \\[\\[B]]")).toBe(
      "[[A]] then [[B]]",
    );
  });
});
