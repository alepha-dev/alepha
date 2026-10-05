import type { ElementRef } from "../../shared/element/elementRef.ts";
import { useQuestImageUpload } from "../../shared/markdown-editor/useQuestImageUpload.ts";

/**
 * Where an image pasted into a quest goes: the quest-attachments bucket,
 * registered by `WorkShell` on core's `ElementReferenceRegistry` (#E75,
 * #Q2624).
 *
 * ⚠️ Quests only, never epics. Those ids become readable to the rest of the
 * project because `QuestService.mergeEmbeddedAttachments` scans saved QUEST
 * markdown and records them on `quest.attachments`. An epic has no such
 * column and no such merge, so borrowing this would upload fine and then
 * leave a file nobody but its uploader is granted.
 */
export const useQuestElementImageUpload = (
  // Unread: the bucket is the project's, whatever quest is open.
  _element: ElementRef,
  enabled: boolean,
): ((file: File) => Promise<string>) | undefined => {
  const upload = useQuestImageUpload();
  return enabled ? upload : undefined;
};
