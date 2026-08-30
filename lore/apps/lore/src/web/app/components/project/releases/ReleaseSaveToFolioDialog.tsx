import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { useI18n } from "alepha/react/i18n";
import { BookMarked } from "lucide-react";
import { useState } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseSaveToFolioDialogProps {
  defaultTitle: string;
  saving: boolean;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

/**
 * Body of the "Save to Folios" dialog. A changelog saved into the project's
 * folios becomes readable over MCP, so the title is worth a prompt rather
 * than being generated silently.
 */
const ReleaseSaveToFolioDialog = (props: ReleaseSaveToFolioDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [title, setTitle] = useState(props.defaultTitle);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm text-pretty">
        {tr("release.folio.description")}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label>{tr("release.folio.title")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={props.onCancel}>
          {tr("release.start.cancel")}
        </Button>
        <Button
          disabled={props.saving || title.trim().length === 0}
          onClick={() => props.onConfirm(title.trim())}
        >
          <BookMarked className="size-4" />
          {tr("release.folio.save")}
        </Button>
      </div>
    </div>
  );
};

export default ReleaseSaveToFolioDialog;
