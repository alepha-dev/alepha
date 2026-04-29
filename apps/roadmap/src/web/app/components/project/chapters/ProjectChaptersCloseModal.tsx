import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";
import type { ChapterWithCount } from "./ProjectChapters.tsx";

export interface ProjectChaptersCloseModalProps {
  chapter: ChapterWithCount;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

const ProjectChaptersCloseModal = (props: ProjectChaptersCloseModalProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [title, setTitle] = useState(props.chapter.title);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{tr("chapter.close.modal.description")}</p>
      <div className="flex flex-col gap-1.5">
        <Label>{tr("chapter.close.modal.label")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim())
              props.onConfirm(title.trim());
          }}
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={props.onCancel}>
          {tr("chapter.start.cancel")}
        </Button>
        <Button
          variant="outline"
          disabled={!title.trim()}
          onClick={() => props.onConfirm(title.trim())}
          className="bg-orange-600 text-white hover:bg-orange-700"
        >
          {tr("chapter.close")}
        </Button>
      </div>
    </div>
  );
};

export default ProjectChaptersCloseModal;
