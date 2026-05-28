import { describe, it } from "vitest";
import {
  type BlobRef,
  rewriteFolioWikiLinks,
} from "../src/web/app/components/folios/rewriteFolioWikiLinks.ts";

const imagePng: BlobRef = {
  fileId: "11111111-1111-1111-1111-111111111111",
  shortId: 42,
  name: "diagram.png",
  mime: "image/png",
  size: 12_345,
};

const imageJpegByExtOnly: BlobRef = {
  fileId: "22222222-2222-2222-2222-222222222222",
  shortId: 7,
  name: "photo.JPG",
};

const nonImageCsv: BlobRef = {
  fileId: "33333333-3333-3333-3333-333333333333",
  shortId: 5,
  name: "data.csv",
  mime: "text/csv",
  size: 8_192,
};

const CAMPAIGN_ID = 99;

describe("rewriteFolioWikiLinks — blob references (Phase 1)", () => {
  it("rewrites [[blob:#N]] to a markdown link to /api/files/<uuid>", ({
    expect,
  }) => {
    const out = rewriteFolioWikiLinks(
      "See [[blob:#42]] for the diagram.",
      CAMPAIGN_ID,
      [],
      [],
      [],
      [imagePng],
    );
    expect(out).toBe(
      "See [diagram.png](/api/files/11111111-1111-1111-1111-111111111111) for the diagram.",
    );
  });

  it("rewrites [[blob:<uuid>]] to a markdown link to /api/files/<uuid>", ({
    expect,
  }) => {
    const out = rewriteFolioWikiLinks(
      "Linked: [[blob:11111111-1111-1111-1111-111111111111]].",
      CAMPAIGN_ID,
      [],
      [],
      [],
      [imagePng],
    );
    expect(out).toBe(
      "Linked: [diagram.png](/api/files/11111111-1111-1111-1111-111111111111).",
    );
  });

  it("preserves the literal token when blob shortId is unknown", ({
    expect,
  }) => {
    const out = rewriteFolioWikiLinks(
      "Stale: [[blob:#999]].",
      CAMPAIGN_ID,
      [],
      [],
      [],
      [imagePng],
    );
    expect(out).toBe(
      "Stale: [\\[\\[blob:#999\\]\\]](lore-broken:blob-not-found).",
    );
  });

  it("rewrites ![alt](blob:#N) for image MIME to an inline img URL", ({
    expect,
  }) => {
    const out = rewriteFolioWikiLinks(
      "![Architecture diagram](blob:#42)",
      CAMPAIGN_ID,
      [],
      [],
      [],
      [imagePng],
    );
    expect(out).toBe(
      "![Architecture diagram](/api/files/11111111-1111-1111-1111-111111111111)",
    );
  });

  it("detects image MIME by file extension when mime is missing", ({
    expect,
  }) => {
    const out = rewriteFolioWikiLinks(
      "![](blob:#7)",
      CAMPAIGN_ID,
      [],
      [],
      [],
      [imageJpegByExtOnly],
    );
    expect(out).toBe(
      "![photo.JPG](/api/files/22222222-2222-2222-2222-222222222222)",
    );
  });

  it("rewrites ![alt](blob:#N) for non-image to a paperclip download link with size", ({
    expect,
  }) => {
    const out = rewriteFolioWikiLinks(
      "![Latest data](blob:#5)",
      CAMPAIGN_ID,
      [],
      [],
      [],
      [nonImageCsv],
    );
    // 8192 bytes → 8 KB. Paperclip prefix + size suffix.
    expect(out).toBe(
      "[📎 data.csv (8 KB)](/api/files/33333333-3333-3333-3333-333333333333)",
    );
  });

  it("leaves ![alt](blob:#N) untouched when blob is unknown", ({ expect }) => {
    const out = rewriteFolioWikiLinks(
      "![](blob:#999)",
      CAMPAIGN_ID,
      [],
      [],
      [],
      [imagePng],
    );
    expect(out).toBe("![](blob:#999)");
  });

  it("handles wiki + image blob refs in the same content", ({ expect }) => {
    const out = rewriteFolioWikiLinks(
      "See [[blob:#42]] and ![](blob:#5)",
      CAMPAIGN_ID,
      [],
      [],
      [],
      [imagePng, nonImageCsv],
    );
    expect(out).toBe(
      "See [diagram.png](/api/files/11111111-1111-1111-1111-111111111111) and [📎 data.csv (8 KB)](/api/files/33333333-3333-3333-3333-333333333333)",
    );
  });

  it("skips entirely when content has no [[ and no blob: image syntax", ({
    expect,
  }) => {
    const input = "plain markdown with no links";
    const out = rewriteFolioWikiLinks(
      input,
      CAMPAIGN_ID,
      [],
      [],
      [],
      [imagePng],
    );
    expect(out).toBe(input);
  });
});
