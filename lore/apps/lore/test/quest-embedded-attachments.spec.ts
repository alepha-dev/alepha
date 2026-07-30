import { describe, expect, it } from "vitest";
import { QuestService } from "../src/api/services/QuestService.ts";

/**
 * Embedded editor images (`![alt](/api/files/<uuid>)`) must be folded
 * into `quest.attachments` on save: being listed there is what lets
 * `LoreFileAccessProvider` resolve the file to a campaign so every
 * member can read it. See the markdown-editor spec (2026-07-30).
 */
describe("QuestService.mergeEmbeddedAttachments", () => {
  // The method is pure (no `this` access) — call it off the prototype so
  // the test doesn't have to boot a container + database just for a
  // string scanner. Repository-backed behavior is covered by the quest
  // integration specs.
  const service = {
    mergeEmbeddedAttachments: QuestService.prototype.mergeEmbeddedAttachments,
  };

  const idA = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const idB = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  it("collects file ids embedded in markdown", () => {
    const text = `intro\n\n![shot](/api/files/${idA})\n`;
    expect(service.mergeEmbeddedAttachments([text], [])).toEqual([idA]);
  });

  it("merges with existing attachments without duplicating", () => {
    const text = `![a](/api/files/${idA}) and again ![a2](/api/files/${idA})`;
    expect(service.mergeEmbeddedAttachments([text], [idA, idB])).toEqual([
      idA,
      idB,
    ]);
  });

  it("scans several texts and skips undefined ones", () => {
    const result = service.mergeEmbeddedAttachments(
      [undefined, `![a](/api/files/${idA})`, `see /api/files/${idB}`],
      [],
    );
    expect(result).toEqual([idA, idB]);
  });

  it("ignores non-uuid file paths", () => {
    const text = "![x](/api/files/not-a-uuid) and /api/files/123";
    expect(service.mergeEmbeddedAttachments([text], [])).toEqual([]);
  });
});
