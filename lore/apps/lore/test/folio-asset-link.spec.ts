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

const PROJECT_SLUG = "sds";

describe("rewriteFolioWikiLinks — assets/ references", () => {
  it("rewrites ![alt](assets/<name>) to the file URL", ({ expect }) => {
    const out = rewriteFolioWikiLinks(
      "Here: ![A diagram](assets/diagram.png)",
      PROJECT_SLUG,
      [],
      [],
      [imagePng],
    );
    expect(out).toBe(
      "Here: ![A diagram](/api/files/11111111-1111-1111-1111-111111111111)",
    );
  });

  it("matches the attachment name case-insensitively", ({ expect }) => {
    // The stored name is `photo.JPG`; the reference says `photo.jpg`.
    // An empty alt is filled with the attachment's name: a rendered `<img>`
    // with no alt text is an accessibility hole, and the author wrote no
    // better label to keep.
    const out = rewriteFolioWikiLinks(
      "![](assets/photo.jpg)",
      PROJECT_SLUG,
      [],
      [],
      [imageJpegByExtOnly],
    );
    expect(out).toBe(
      "![photo.JPG](/api/files/22222222-2222-2222-2222-222222222222)",
    );
  });

  it("degrades a non-image attachment to a paperclip download link", ({
    expect,
  }) => {
    const out = rewriteFolioWikiLinks(
      "![](assets/data.csv)",
      PROJECT_SLUG,
      [],
      [],
      [nonImageCsv],
    );
    expect(out).toBe(
      "[📎 data.csv (8 KB)](/api/files/33333333-3333-3333-3333-333333333333)",
    );
  });

  it("leaves an unknown assets/ path as a broken-link marker", ({ expect }) => {
    const out = rewriteFolioWikiLinks(
      "![](assets/missing.png)",
      PROJECT_SLUG,
      [],
      [],
      [imagePng],
    );
    // Deliberately not left as a raw `assets/missing.png` src: that renders
    // as a broken-image icon with no explanation of why.
    expect(out).toContain("#lore-broken:blob-not-found");
  });

  it("rewrites a plain link to an attachment, not just an embed", ({
    expect,
  }) => {
    const out = rewriteFolioWikiLinks(
      "See [the data](assets/data.csv).",
      PROJECT_SLUG,
      [],
      [],
      [nonImageCsv],
    );
    expect(out).toBe(
      "See [the data](/api/files/33333333-3333-3333-3333-333333333333).",
    );
  });

  it("leaves a non-assets relative path alone", ({ expect }) => {
    const input = "![](other/diagram.png)";
    const out = rewriteFolioWikiLinks(input, PROJECT_SLUG, [], [], [imagePng]);
    expect(out).toBe(input);
  });
});
