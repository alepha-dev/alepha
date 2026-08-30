import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Save } from "lucide-react";
import { useState } from "react";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { Release } from "@/api/entities/releases.ts";
import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseEditFormProps {
  release: ReleaseResource;
  onUpdated: (release: Release) => void;
}

const ReleaseEditForm = (props: ReleaseEditFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<ReleaseController>();
  const [tag, setTag] = useState(props.release.tag ?? "");
  const [title, setTitle] = useState(props.release.title);
  const [description, setDescription] = useState(props.release.description);
  const [targetDate, setTargetDate] = useState(
    props.release.targetDate?.slice(0, 10) ?? "",
  );
  const [saving, setSaving] = useState(false);

  const published = !!props.release.releasedAt;

  const dirty =
    tag !== (props.release.tag ?? "") ||
    title !== props.release.title ||
    description !== props.release.description ||
    targetDate !== (props.release.targetDate?.slice(0, 10) ?? "");

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateRelease({
        params: { id: props.release.id },
        body: {
          ...(tag ? { tag } : {}),
          title,
          description,
          // `null` clears the estimate; the server distinguishes it from an
          // omitted key, which means "leave alone".
          targetDate: targetDate ? `${targetDate}T00:00:00.000Z` : null,
        },
      });
      props.onUpdated(updated);
      toaster.success(tr("release.detail.saved"));
    } catch {
      // The fields keep what was typed: the save failed, so the form is
      // still the unsaved truth and `dirty` must stay true.
      toaster.error(tr("release.detail.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="font-mono">
          {props.release.tag ?? `#${props.release.number}`}
        </Badge>
        {published ? (
          <Badge variant="outline">{tr("release.status.closed")}</Badge>
        ) : (
          <Badge className="bg-green-600 text-white">
            {tr("release.status.active")}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("release.detail.editTag")}</Label>
        <Input
          value={tag}
          disabled={published}
          className="font-mono"
          onChange={(e) => setTag(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("release.detail.editTitle")}</Label>
        <Input
          value={title}
          disabled={published}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("release.detail.editDescription")}</Label>
        <Textarea
          rows={3}
          value={description}
          disabled={published}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("release.detail.editTargetDate")}</Label>
        <Input
          type="date"
          value={targetDate}
          disabled={published}
          onChange={(e) => setTargetDate(e.currentTarget.value)}
        />
      </div>

      {/* Disabled rather than hidden: a published release is meant to read
          as frozen, and an absent form says nothing about why. The server
          refuses too - this is the affordance, not the guard. */}
      <Button onClick={handleSave} disabled={published || !dirty || saving}>
        <Save className="size-4" />
        {tr("release.detail.save")}
      </Button>
    </div>
  );
};

export default ReleaseEditForm;
