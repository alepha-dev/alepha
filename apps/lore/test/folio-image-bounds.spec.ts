import { describe, it } from "vitest";

import { FOLIO_IMAGE_MAX_WIDTH } from "../src/web/app/components/folios/folioImageBounds.ts";

/**
 * Every folio image upload path must downscale through the SAME bound.
 *
 * There are three of them — the editor's image button, a ⌘V paste (MDXEditor
 * routes clipboard images through the editor's upload handler), and the
 * Attachments panel — and only two of them are obvious. The paste path was
 * shipped without compression precisely because it is invisible: it has no
 * UI of its own, so reading the components does not reveal it.
 *
 * Asserted by reading the sources rather than by rendering: what matters is
 * that no upload path exists which does not call `resizeImage`, and that is
 * a property of the file set, not of any one component's behaviour.
 */
const read = async (path: string): Promise<string> => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  return readFile(join(import.meta.dirname, "..", path), "utf8");
};

const UPLOAD_PATHS = [
  "src/web/app/components/shared/markdown-editor/useFolioImageUpload.ts",
  "src/web/app/components/folios/editor/inspector/FolioAttachmentsTab.tsx",
];

describe("folio image uploads are always downscaled", () => {
  for (const path of UPLOAD_PATHS) {
    it(`${path} resizes before uploading`, async ({ expect }) => {
      const source = await read(path);
      expect(source).toContain("resizeImage");
      // The shared constant, never a local literal — two entry points
      // disagreeing on the bound is a bug with no visible cause.
      expect(source).toContain("FOLIO_IMAGE_MAX_WIDTH");
      expect(source).not.toMatch(/maxWidth:\s*\d+/);
    });

    it(`${path} uploads the RESIZED file, not the original`, async ({
      expect,
    }) => {
      const source = await read(path);
      // The subtle way to get this wrong is to call `resizeImage` and then
      // append the original anyway — which compresses nothing while looking
      // entirely correct. `resizeImage` also renames `.png` to `.webp` when
      // it re-encodes, so the appended file is what decides the stored
      // attachment name too.
      expect(source).toContain('form.append("file", file)');
      expect(source).not.toContain('form.append("file", original)');
    });
  }

  it("uses a bound suited to the prose measure, not the logo's", ({
    expect,
  }) => {
    // 256 is the project logo's bound (a 32px box). A folio image renders at
    // the document's full width, so reusing that number would visibly
    // degrade every screenshot.
    expect(FOLIO_IMAGE_MAX_WIDTH).toBeGreaterThanOrEqual(1024);
  });
});
