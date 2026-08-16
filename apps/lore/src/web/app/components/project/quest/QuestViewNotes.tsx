import { Button } from "@alepha/ui/components/ui/button";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import MarkdownEditor from "../../shared/markdown-editor/MarkdownEditor.tsx";
import type { MarkdownEditorMode } from "../../shared/markdown-editor/MarkdownEditorInner.tsx";
import MarkdownModeToggle from "../../shared/markdown-editor/MarkdownModeToggle.tsx";
import { useQuestImageUpload } from "../../shared/markdown-editor/useQuestImageUpload.ts";

export interface QuestViewNotesProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
}

const QuestViewNotes = (props: QuestViewNotesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const alepha = useAlepha();
  const imageUploadHandler = useQuestImageUpload();

  const [noteText, setNoteText] = useState(props.quest.note ?? "");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<MarkdownEditorMode>("edit");

  useEffect(() => {
    setNoteText(props.quest.note ?? "");
  }, [props.quest.note]);

  const handleSave = async () => {
    if (noteText === (props.quest.note ?? "")) return;
    setSaving(true);
    try {
      const updated = await client.updateQuestNote({
        params: { id: props.quest.id },
        body: { note: noteText },
      });
      props.onUpdate(updated);
      const list = alepha.store.get(currentAssignedQuestsAtom) ?? [];
      alepha.store.set(
        currentAssignedQuestsAtom,
        list.map((q) => (q.id === updated.id ? updated : q)),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 px-1">
      <div className="flex justify-end">
        <MarkdownModeToggle mode={mode} onChange={setMode} />
      </div>
      <MarkdownEditor
        placeholder={tr("quest.view.notes.placeholder")}
        value={noteText}
        onChange={setNoteText}
        imageUploadHandler={imageUploadHandler}
        mode={mode}
        minHeight={140}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={saving || noteText === (props.quest.note ?? "")}
          onClick={handleSave}
        >
          {tr("quest.view.notes.save")}
        </Button>
      </div>
    </div>
  );
};

export default QuestViewNotes;
