import MarkdownEditor from "../../shared/markdown-editor/MarkdownEditor.tsx";
import { useQuestImageUpload } from "../../shared/markdown-editor/useQuestImageUpload.ts";

export interface QuestDescriptionEditorProps {
  value?: unknown;
  onChange?: (value: unknown) => void;
}

/**
 * Markdown editor for quest-side rich-text fields, shaped to the
 * `Control custom` contract so `QuestCreate` can bind it to a form input.
 * Module-level (stable identity) — an inline closure would remount the
 * editor and drop focus on every parent render.
 */
const QuestDescriptionEditor = (props: QuestDescriptionEditorProps) => {
  const imageUploadHandler = useQuestImageUpload();

  return (
    <MarkdownEditor
      value={typeof props.value === "string" ? props.value : ""}
      onChange={(v) => props.onChange?.(v)}
      imageUploadHandler={imageUploadHandler}
      minHeight={220}
    />
  );
};

export default QuestDescriptionEditor;
