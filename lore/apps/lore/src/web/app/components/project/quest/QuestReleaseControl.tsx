import { Control } from "@alepha/ui/components/control/control";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Flag } from "lucide-react";
import { useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * One optional number. "No release" is the field being empty, which is what
 * `Control`'s `clearable` row sets it to - the `"none"` string sentinel the
 * raw `<Select>` needed is gone with it.
 */
const releaseFormSchema = z.object({
  releaseId: z.number().optional(),
});

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

  const change = async (value?: number) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const updated = await questApi.updateQuestById({
        params: { id: props.quest.id },
        // `null` detaches; an absent key would leave the attachment alone.
        body: { releaseId: value ?? null },
      });
      props.onUpdate(updated);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
      // The write is the only thing that moves this field, so a failed one has
      // to put the trigger back: the `<Select>` this replaced was driven
      // straight off `props.quest` and reverted by re-rendering.
      form.setInitialValues(
        { releaseId: props.quest.releaseId ?? undefined },
        { keepDirty: false },
      );
    } finally {
      setSubmitting(false);
    }
  };

  const form = useForm({
    schema: releaseFormSchema,
    initialValues: { releaseId: props.quest.releaseId ?? undefined },
    // Nothing is submitted: picking a row IS the write.
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, value) => void change(value as number | undefined),
  });

  return (
    <Control
      input={form.input.releaseId}
      // The rail row beside it carries the label, so the trigger names itself
      // to assistive tech instead.
      label=""
      inputProps={{ "aria-label": String(tr("quest.rail.release")) }}
      icon={Flag}
      clearable
      clearLabel={String(tr("quest.rail.release.none"))}
      // `minimal size="xs"` rather than a hand-rolled className: the rail is
      // `text-xs` throughout, and the row above this one (Assigned) is a
      // small transparent trigger that sits on the line like text. A boxed,
      // default-height select beside it read as visibly heavier (#1703).
      minimal
      size="xs"
      triggerClassName="w-auto"
      disabled={submitting || !!current?.releasedAt}
      items={options.map((release) => ({
        value: String(release.id),
        label: release.tag ?? release.title,
      }))}
    />
  );
};

export default QuestReleaseControl;
