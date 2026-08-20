import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus, Tags as TagsIcon } from "lucide-react";
import { useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestTagInput from "./QuestTagInput.tsx";

export interface QuestViewRailTagsProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
}

/**
 * The rail's tags block: monospace chips, plus an inline `+ tag` that swaps
 * in the same chip input the create form uses (autocomplete over the
 * project's existing tags included).
 *
 * Tags and the reminder control are the only interactive things in the rail.
 * They earn it for the same reason: both are one-value edits with no
 * validation to fail, so a round-trip through the edit drawer would cost more
 * than the edit itself.
 */
const QuestViewRailTags = (props: QuestViewRailTagsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const questApi = useClient<QuestController>();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const tags = props.quest.tags ?? [];
  const canEdit = questApi.updateQuestById.can() && !props.quest.completedAt;

  const save = async (next: string[]) => {
    setSaving(true);
    try {
      const updated = await questApi.updateQuestById({
        params: { id: props.quest.id },
        body: { tags: next },
      });
      props.onUpdate(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <TagsIcon className="size-3.5" />
        {tr("quest.create.tags")}
      </span>

      {editing ? (
        <QuestTagInput
          value={tags}
          disabled={saving}
          projectId={props.quest.projectId}
          onChange={(next) => void save(next)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="font-mono text-[11px] leading-none"
            >
              {tag}
            </Badge>
          ))}
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground h-6 gap-1 px-1.5 text-[11px]"
              onClick={() => setEditing(true)}
            >
              <Plus className="size-3" />
              {tr("quest.rail.addTag")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestViewRailTags;
