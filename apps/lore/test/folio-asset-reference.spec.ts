import { describe, it } from "vitest";

import {
  folioAssetEmbed,
  folioAssetPath,
} from "../src/web/app/components/folios/folioAssetReference.ts";
import {
  type BlobRef,
  rewriteFolioWikiLinks,
} from "../src/web/app/components/folios/rewriteFolioWikiLinks.ts";

const PROJECT_SLUG = "sds";

const blobNamed = (name: string): BlobRef => ({
  fileId: "11111111-1111-1111-1111-111111111111",
  shortId: 1,
  name,
  mime: "image/webp",
  size: 2048,
});

/**
 * The writers and the reader of an `assets/` reference are three different
 * files, and a disagreement between them is invisible: the folio renders a
 * broken-link marker for a file that is plainly listed in the Attachments
 * panel, and no test, type or lint rule notices.
 *
 * So this asserts the round-trip rather than the string. Each case is a name
 * whose encoding is the thing that could break.
 */
describe("folio asset references round-trip through the reader", () => {
  const names = [
    "photo.webp",
    "my photo.webp",
    "screenshot (1).png",
    "été.png",
    "a&b.png",
    "100% done.png",
    "notes#draft.png",
    "a+b.png",
  ];

  for (const name of names) {
    it(`resolves ${JSON.stringify(name)}`, ({ expect }) => {
      const out = rewriteFolioWikiLinks(
        folioAssetEmbed(name),
        PROJECT_SLUG,
        [],
        [],
        [blobNamed(name)],
      );

      expect(out).toBe(
        `![${name}](/api/files/11111111-1111-1111-1111-111111111111)`,
      );
    });
  }

  it("builds a path the reader treats as an attachment, not a folder", ({
    expect,
  }) => {
    expect(folioAssetPath("photo.webp")).toBe("assets/photo.webp");
  });

  it("still resolves when the author typed the name unencoded", ({
    expect,
  }) => {
    // Hand-written markdown will not be percent-encoded, and has to work
    // anyway — the encoding is a writer-side convenience, not a contract.
    const out = rewriteFolioWikiLinks(
      "![](assets/my photo.webp)",
      PROJECT_SLUG,
      [],
      [],
      [blobNamed("my photo.webp")],
    );
    expect(out).toContain("/api/files/11111111-1111-1111-1111-111111111111");
  });
});
