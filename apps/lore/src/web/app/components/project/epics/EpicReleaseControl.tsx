import { Control } from "@alepha/ui/components/control/control";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Flag } from "lucide-react";
import { useState } from "react";

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
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

export interface EpicReleaseControlProps {
  epic: EpicResource;
  onChange: (epic: EpicResource) => void;
}

/**
 * Which release this epic ships in, as one control on the epic's own page.
 *
 * **Only open releases are offered.** A published release's contents are its
 * record and its progress counts are frozen on the row, so attaching to one
 * would make the row disagree with itself. The server refuses too
 * (`ReleaseAttachmentService`) - this is the affordance, not the guard.
 *
 * The epic's CURRENT release stays in the list even once published, so the
 * control can show what it is rather than falling back to "none" and reading
 * as though the attachment were lost.
 */
const EpicReleaseControl = (props: EpicReleaseControlProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const epicApi = useClient<EpicController>();
  const [releases] = useStore(currentReleasesAtom);
  const [submitting, setSubmitting] = useState(false);

  const current = releases?.find((r) => r.id === props.epic.releaseId);
  const options = (releases ?? []).filter(
    (r) => !r.releasedAt || r.id === props.epic.releaseId,
  );

  const change = async (value?: number) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const updated = await epicApi.updateEpic({
        params: { id: props.epic.id },
        // `null` detaches; an absent key would leave the attachment alone.
        body: { releaseId: value ?? null },
      });
      props.onChange(updated);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
      // The write is the only thing that moves this field, so a failed one has
      // to put the trigger back: the `<Select>` this replaced was driven
      // straight off `props.epic` and reverted by re-rendering.
      form.setInitialValues(
        { releaseId: props.epic.releaseId ?? undefined },
        { keepDirty: false },
      );
    } finally {
      setSubmitting(false);
    }
  };

  const form = useForm({
    schema: releaseFormSchema,
    initialValues: { releaseId: props.epic.releaseId ?? undefined },
    // Nothing is submitted: picking a row IS the write.
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, value) => void change(value as number | undefined),
  });

  return (
    <Control
      input={form.input.releaseId}
      // The aside row beside it carries the label, so the trigger names itself
      // to assistive tech instead.
      label=""
      inputProps={{ "aria-label": String(tr("epic.aside.release")) }}
      // The release glyph every other surface uses, so the flag reads as
      // "release" here too (feedback #2061).
      icon={Flag}
      clearable
      clearLabel={String(tr("epic.aside.release.none"))}
      triggerClassName="w-full"
      disabled={submitting || !!current?.releasedAt}
      items={options.map((release) => ({
        value: String(release.id),
        label: release.tag ?? release.title,
      }))}
    />
  );
};

export default EpicReleaseControl;
