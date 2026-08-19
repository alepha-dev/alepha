import { Button } from "@alepha/ui/components/ui/button";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import LoreEditor from "../../shared/element/LoreEditor.tsx";

export interface QuestViewNotesProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
}

const QuestViewNotes = (props: QuestViewNotesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<QuestController>();
  const alepha = useAlepha();
  // The links the viewer produces are URLs, so the slug is required.
  const [project] = useStore(currentProjectAtom);

  const [noteText, setNoteText] = useState(props.quest.note ?? "");
  const [saving, setSaving] = useState(false);

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
      <LoreEditor
        element={{
          kind: "quest",
          projectId: props.quest.projectId,
          projectSlug: project?.slug ?? "",
          id: props.quest.id,
        }}
        placeholder={tr("quest.view.notes.placeholder")}
        value={noteText}
        onChange={setNoteText}
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
