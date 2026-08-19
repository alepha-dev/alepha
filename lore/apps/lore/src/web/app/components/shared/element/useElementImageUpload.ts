import { useFolioImageUpload } from "../markdown-editor/useFolioImageUpload.ts";
import { useQuestImageUpload } from "../markdown-editor/useQuestImageUpload.ts";
import type { ElementRef } from "./elementRef.ts";

/**
 * The image-upload handler for an element's markdown, chosen by kind.
 *
 * Every surface used to pick its own, which is how the epic description
 * ended up with none by accident rather than by decision. Here the choice
 * is one switch, and the reason each arm differs is written down beside it.
 *
 * Both hooks are called unconditionally — hooks cannot be called behind a
 * branch — and the branch only decides which result is returned.
 */
export const useElementImageUpload = (
  element: ElementRef,
  /**
   * `false` suppresses upload entirely. A protected folio passes this: its
   * bytes must never be written in plaintext next to encrypted content.
   */
  enabled = true,
): ((file: File) => Promise<string>) | undefined => {
  const folioUpload = useFolioImageUpload(
    element.projectId,
    element.kind === "folio" ? (element.id as string | undefined) : undefined,
    enabled && element.kind === "folio",
  );
  const questUpload = useQuestImageUpload();

  if (!enabled) return undefined;
  if (element.kind === "folio") return folioUpload;
  if (element.kind === "quest") return questUpload;

  // Epics have no attachment store. `useQuestImageUpload` writes into the
  // quest-attachments bucket, and those ids only become readable to the
  // rest of the project because `QuestService.mergeEmbeddedAttachments`
  // scans saved QUEST markdown and records them on `quest.attachments`. An
  // epic has no such column and no such merge, so borrowing the quest
  // handler would upload fine and then leave a file nobody but its uploader
  // is granted. Give epics a store before giving this an arm.
  return undefined;
};
