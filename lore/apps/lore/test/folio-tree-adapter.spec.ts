import { describe, expect, it } from "vitest";

import {
  buildFolioTree,
  findFolioNode,
} from "@/web/app/components/folios/editor/tree/folioTree.ts";

/**
 * The model itself is tested in `@alepha/ui`
 * (`components/tree-view/__tests__/tree-model.spec.ts`). What is left here is
 * the translation Lore owns: two lists into one, `title` into `name`,
 * `directoryId` into `parentId`, and the three fields of the payload.
 */
describe("buildFolioTree", () => {
  const fixture = () =>
    buildFolioTree({
      directories: [{ id: "d-arch", name: "architecture", shortId: 1 }],
      folios: [
        {
          id: "f-runtime",
          title: "Runtime lifecycle",
          shortId: 10,
          directoryId: "d-arch",
        },
        { id: "f-conv", title: "Conventions", shortId: 13, pinned: true },
        { id: "f-keys", title: "Deploy keys", shortId: 14, protected: true },
      ],
    });

  it("marks a protected folio with its own kind", () => {
    const tree = fixture();
    expect(findFolioNode(tree, "f-keys")?.data.kind).toBe("protected");
    expect(findFolioNode(tree, "f-conv")?.data.kind).toBe("folio");
  });

  it("carries the pinned flag through", () => {
    expect(findFolioNode(fixture(), "f-conv")?.data.pinned).toBe(true);
  });

  it("maps a directory to a branch and a folio to a leaf", () => {
    const tree = fixture();
    expect(findFolioNode(tree, "d-arch")?.branch).toBe(true);
    expect(findFolioNode(tree, "f-conv")?.branch).toBe(false);
  });

  it("maps title to name, directoryId to parentId, and keeps the shortId", () => {
    const runtime = findFolioNode(fixture(), "f-runtime");
    expect(runtime?.name).toBe("Runtime lifecycle");
    expect(runtime?.parentId).toBe("d-arch");
    expect(runtime?.data.shortId).toBe(10);
  });
});
