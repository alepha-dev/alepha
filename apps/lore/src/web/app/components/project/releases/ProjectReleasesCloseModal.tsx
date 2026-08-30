import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectReleasesCloseModalProps {
  release: ReleaseResource;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

const ProjectReleasesCloseModal = (props: ProjectReleasesCloseModalProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [title, setTitle] = useState(props.release.title);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{tr("release.close.modal.description")}</p>
      <div className="flex flex-col gap-1.5">
        <Label>{tr("release.close.modal.label")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim())
              props.onConfirm(title.trim());
          }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={props.onCancel}>
          {tr("release.start.cancel")}
        </Button>
        <Button
          variant="outline"
          disabled={!title.trim()}
          onClick={() => props.onConfirm(title.trim())}
          className="bg-orange-600 text-white hover:bg-orange-700"
        >
          {tr("release.close")}
        </Button>
      </div>
    </div>
  );
};

export default ProjectReleasesCloseModal;
