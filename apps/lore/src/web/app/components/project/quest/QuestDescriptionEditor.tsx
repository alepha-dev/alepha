import { useState } from "react";
import MarkdownEditor from "../../shared/markdown-editor/MarkdownEditor.tsx";
import type { MarkdownEditorMode } from "../../shared/markdown-editor/MarkdownEditorInner.tsx";
import MarkdownModeToggle from "../../shared/markdown-editor/MarkdownModeToggle.tsx";
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
 *
 * Starts in `"edit"`, unlike a folio: this is a field on a form the author
 * came here to fill in, not a document they came here to read.
 */
const QuestDescriptionEditor = (props: QuestDescriptionEditorProps) => {
  const imageUploadHandler = useQuestImageUpload();
  const [mode, setMode] = useState<MarkdownEditorMode>("edit");

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end">
        <MarkdownModeToggle mode={mode} onChange={setMode} />
      </div>
      <MarkdownEditor
        value={typeof props.value === "string" ? props.value : ""}
        onChange={(v) => props.onChange?.(v)}
        imageUploadHandler={imageUploadHandler}
        mode={mode}
        minHeight={220}
      />
    </div>
  );
};

export default QuestDescriptionEditor;
