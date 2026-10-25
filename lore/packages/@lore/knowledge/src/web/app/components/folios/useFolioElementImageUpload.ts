import type { ElementRef } from "@lore/core/web";

import { useFolioImageUpload } from "../shared/markdown-editor/useFolioImageUpload.ts";

/**
 * Where an image pasted into a folio goes: its own attachments, registered
 * by `KnowledgeShell` on core's `ElementReferenceRegistry` (#E75, #Q2624).
 * Nothing for a folio still being created, which has no id to attach to.
 */
export const useFolioElementImageUpload = (
  element: ElementRef,
  enabled: boolean,
): ((file: File) => Promise<string>) | undefined =>
  useFolioImageUpload(
    element.projectId,
    element.id as string | undefined,
    enabled,
  );
