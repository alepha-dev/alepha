import { Alepha } from "alepha";
import { AlephaSystem, ZipArchive } from "alepha/system";
import { describe, it } from "vitest";

import { folioMarkdownExport } from "../src/web/app/components/folios/editor/document/folioMarkdownExport.ts";
import { folioZipEntries } from "../src/web/app/components/folios/editor/document/folioZipExport.ts";

const bytes = (text: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(text);

/**
 * Reads an archive back through its central directory. Deliberately not the
 * writer's own bookkeeping — see `ZipArchive.spec.ts` for the same helper's
 * fuller version and why.
 */
const namesIn = (archive: Uint8Array<ArrayBuffer>): string[] => {
  const view = new DataView(archive.buffer);
  let eocd = -1;
  for (let i = archive.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record");

  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    names.push(
      new TextDecoder().decode(
        archive.subarray(pointer + 46, pointer + 46 + nameLength),
      ),
    );
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return names;
};

const build = async (entries: ReturnType<typeof folioZipEntries>) => {
  const zip = Alepha.create().with(AlephaSystem).inject(ZipArchive);
  return new Uint8Array(
    await new Response(zip.create(entries)).arrayBuffer(),
  ) as Uint8Array<ArrayBuffer>;
};

describe("folio zip export", () => {
  it("puts the markdown at the root and attachments under assets/", async ({
    expect,
  }) => {
    const entries = folioZipEntries({
      filename: "my_folio",
      markdown: "# Notes\n\n![](assets/photo.webp)",
      attachments: [
        {
          name: "photo.webp",
          mimeType: "image/webp",
          data: bytes("fake-webp"),
        },
        { name: "data.csv", mimeType: "text/csv", data: bytes("a,b\n1,2") },
      ],
    });

    expect(namesIn(await build(entries))).toEqual([
      "my_folio.md",
      "assets/photo.webp",
      "assets/data.csv",
    ]);
  });

  it("stores already-compressed media and deflates everything else", ({
    expect,
  }) => {
    const entries = folioZipEntries({
      filename: "f",
      markdown: "# x",
      attachments: [
        { name: "a.webp", mimeType: "image/webp", data: bytes("x") },
        { name: "b.png", mimeType: "image/png", data: bytes("x") },
        { name: "c.csv", mimeType: "text/csv", data: bytes("x") },
        // SVG is an image MIME that is really XML, so it deflates well.
        { name: "d.svg", mimeType: "image/svg+xml", data: bytes("<svg/>") },
        { name: "e.pdf", mimeType: "application/pdf", data: bytes("x") },
      ],
    });

    expect(entries.map((entry) => entry.method)).toEqual([
      "deflate", // the markdown
      "store",
      "store",
      "deflate",
      "deflate",
      "store",
    ]);
  });

  it("carries the folio markdown through byte-for-byte", async ({ expect }) => {
    // The point of `assets/<name>`: what is stored IS what is exported, so
    // the export does no rewriting and cannot drift from the reader.
    const markdown = folioMarkdownExport({
      title: "Notes",
      shortId: 7,
      summary: "s",
      content: "Body with ![](assets/photo.webp) inside.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const entries = folioZipEntries({
      filename: "notes",
      markdown,
      attachments: [],
    });

    expect(new TextDecoder().decode(entries[0].data as Uint8Array)).toBe(
      markdown,
    );
    expect(markdown).toContain("assets/photo.webp");
  });

  it("produces an archive with only the markdown when there are no attachments", async ({
    expect,
  }) => {
    const entries = folioZipEntries({
      filename: "solo",
      markdown: "# Solo",
      attachments: [],
    });

    expect(namesIn(await build(entries))).toEqual(["solo.md"]);
  });
});
