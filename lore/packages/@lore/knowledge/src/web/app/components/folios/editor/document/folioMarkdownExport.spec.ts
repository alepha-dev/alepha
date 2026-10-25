import { describe, it } from "vitest";

import {
  folioExportFilename,
  folioMarkdownExport,
} from "./folioMarkdownExport.ts";

describe("folioMarkdownExport", () => {
  const base = {
    shortId: 42,
    title: "My Folio",
    summary: "A short summary.",
    content: "# Hello\n\nSome body text.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
    pinned: true,
  };

  it("writes the full frontmatter block, matching FolioBrowser's pre-extraction output", ({
    expect,
  }) => {
    const out = folioMarkdownExport(base);
    expect(out).toBe(
      [
        "---",
        "shortId: 42",
        'title: "My Folio"',
        'summary: "A short summary."',
        "pinned: true",
        "createdAt: 2026-01-01T00:00:00.000Z",
        "updatedAt: 2026-02-02T00:00:00.000Z",
        "---",
        "",
        "# Hello\n\nSome body text.",
      ].join("\n"),
    );
  });

  it("omits summary when blank", ({ expect }) => {
    const out = folioMarkdownExport({
      ...base,
      summary: "   ",
    });
    expect(out).not.toContain("summary:");
  });

  // The tag feature is gone, so no `tags:` line is written at all — and a
  // caller that still passes one must not get it smuggled back into the
  // frontmatter through the spread.
  it("writes no tags line", ({ expect }) => {
    const out = folioMarkdownExport(base);
    expect(out).not.toContain("tags:");
  });

  it("escapes backslashes and double quotes in title/summary", ({ expect }) => {
    const out = folioMarkdownExport({
      ...base,
      title: 'A "quoted" \\ title',
      summary: 'has "quotes"',
    });
    expect(out).toContain('title: "A \\"quoted\\" \\\\ title"');
    expect(out).toContain('summary: "has \\"quotes\\""');
  });

  it("writes pinned: false when pinned is omitted", ({ expect }) => {
    const { pinned, ...withoutPinned } = base;
    const out = folioMarkdownExport(withoutPinned);
    expect(out).toContain("pinned: false");
  });
});

describe("folioExportFilename", () => {
  it("lowercases and collapses non-slug characters to underscores", ({
    expect,
  }) => {
    expect(folioExportFilename("My Folio: Draft #2!")).toBe("my_folio_draft_2");
  });

  it("falls back to 'folio' for a blank or whitespace-only title", ({
    expect,
  }) => {
    expect(folioExportFilename("")).toBe("folio");
    expect(folioExportFilename("   ")).toBe("folio");
  });

  it("preserves dots, dashes and underscores", ({ expect }) => {
    expect(folioExportFilename("v1.2-release_notes")).toBe(
      "v1.2-release_notes",
    );
  });
});
