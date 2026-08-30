import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * The sentinel for "no release". A `SelectItem` cannot carry an empty value,
 * and the API distinguishes `null` (detach) from an absent key (leave alone).
 */
const NONE = "none";

export interface QuestReleaseControlProps {
  quest: QuestResource;
  onUpdate: (quest: QuestResource) => void;
}

/**
 * Which release this quest ships in.
 *
 * This is the loose-work half of the model: a hotfix, a doc pass, one chore
 * that must be in `0.28.0` without deserving an epic of its own.
 *
 * **Only open releases are offered**, plus the quest's own current one so a
 * published attachment still shows itself rather than reading as lost. The
 * server refuses either direction on a published release
 * (`ReleaseAttachmentService`) - this is the affordance, not the guard.
 */
const QuestReleaseControl = (props: QuestReleaseControlProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const questApi = useClient<QuestController>();
  const [releases] = useStore(currentReleasesAtom);
  const [submitting, setSubmitting] = useState(false);

  const current = releases?.find((r) => r.id === props.quest.releaseId);
  const options = (releases ?? []).filter(
    (r) => !r.releasedAt || r.id === props.quest.releaseId,
  );

  const change = async (value: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const updated = await questApi.updateQuestById({
        params: { id: props.quest.id },
        body: { releaseId: value === NONE ? null : Number(value) },
      });
      props.onUpdate(updated);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Select
      value={props.quest.releaseId ? String(props.quest.releaseId) : NONE}
      // ⚠️ Without `items` the trigger prints the release ID rather than its
      // tag. See `EpicReleaseControl` for the full account: this control had
      // the identical defect, found by grepping for bare `<SelectValue />`
      // whose value is an id, and nothing had reported it.
      items={[
        { value: NONE, label: String(tr("quest.rail.release.none")) },
        ...options.map((release) => ({
          value: String(release.id),
          label: release.tag ?? release.title,
        })),
      ]}
      onValueChange={(value) => void change(String(value))}
      disabled={submitting || !!current?.releasedAt}
    >
      <SelectTrigger size="sm" className="h-7 w-auto border-none shadow-none">
        <SelectValue placeholder={tr("quest.rail.release.none")} />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={NONE}>{tr("quest.rail.release.none")}</SelectItem>
        {options.map((release) => (
          <SelectItem key={release.id} value={String(release.id)}>
            {release.tag ?? release.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default QuestReleaseControl;
