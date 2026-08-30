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

import type { EpicController } from "@/api/controllers/EpicController.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import { currentReleasesAtom } from "@/web/app/atoms/currentReleasesAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * The sentinel for "no release". A `SelectItem` cannot carry an empty value,
 * and the API distinguishes `null` (detach) from an absent key (leave alone),
 * so the two have to stay tellable apart all the way down.
 */
const NONE = "none";

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

  const change = async (value: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const updated = await epicApi.updateEpic({
        params: { id: props.epic.id },
        body: { releaseId: value === NONE ? null : Number(value) },
      });
      props.onChange(updated);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Select
      value={props.epic.releaseId ? String(props.epic.releaseId) : NONE}
      // ⚠️ Without `items` the trigger prints the release ID. Base UI's
      // `Select.Value` renders the VALUE, not the selected row's label, and
      // the rows live in a popup that is unmounted until first opened, so
      // there is nothing for it to resolve a label from. The epic aside read
      // `11` where it should have read `0.28.0`.
      //
      // Same fix, and the same reasoning, as `AreaMergeDialog`.
      items={[
        { value: NONE, label: String(tr("epic.aside.release.none")) },
        ...options.map((release) => ({
          value: String(release.id),
          label: release.tag ?? release.title,
        })),
      ]}
      onValueChange={(value) => void change(String(value))}
      disabled={submitting || !!current?.releasedAt}
    >
      <SelectTrigger size="sm" className="w-full">
        <SelectValue placeholder={tr("epic.aside.release.none")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{tr("epic.aside.release.none")}</SelectItem>
        {options.map((release) => (
          <SelectItem key={release.id} value={String(release.id)}>
            {release.tag ?? release.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default EpicReleaseControl;
