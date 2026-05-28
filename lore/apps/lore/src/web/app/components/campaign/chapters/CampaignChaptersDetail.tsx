import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Copy, Download, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChapterController } from "@/api/controllers/ChapterController.ts";
import type { Chapter } from "@/api/entities/chapters.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import ChapterTagInput from "./ChapterTagInput.tsx";

export interface CampaignChaptersDetailProps {
  chapter: Chapter;
  onUpdated: (chapter: Chapter) => void;
}

const CampaignChaptersDetail = (props: CampaignChaptersDetailProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<ChapterController>();
  const [title, setTitle] = useState(props.chapter.title);
  const [description, setDescription] = useState(props.chapter.description);
  const [tags, setTags] = useState<string[]>(props.chapter.tags ?? []);
  const [markdown, setMarkdown] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await api.getChapterChangelog({
        params: { id: props.chapter.id },
      });
      if (!cancelled) setMarkdown(result.markdown);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.chapter.id]);

  const dirty =
    title !== props.chapter.title ||
    description !== props.chapter.description ||
    JSON.stringify(tags) !== JSON.stringify(props.chapter.tags ?? []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateChapter({
        params: { id: props.chapter.id },
        body: { title, description, tags },
      });
      props.onUpdated(updated);
      toaster.success(String(tr("chapter.detail.saved")));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    toaster.success(String(tr("chapter.changelog.copied")));
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chapter-${props.chapter.number}-changelog.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">#{props.chapter.number}</Badge>
        {props.chapter.closedAt && (
          <Badge variant="outline">{tr("chapter.status.closed")}</Badge>
        )}
        {!props.chapter.closedAt && (
          <Badge className="bg-green-600 text-white">
            {tr("chapter.status.active")}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("chapter.detail.editTitle")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("chapter.detail.editDescription")}</Label>
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("chapter.tags")}</Label>
        <ChapterTagInput value={tags} onChange={setTags} />
      </div>

      <Button onClick={handleSave} disabled={!dirty || saving}>
        <Save className="size-4" />
        {tr("chapter.detail.save")}
      </Button>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>{tr("chapter.changelog")}</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="size-3.5" />
              {tr("chapter.changelog.copy")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="size-3.5" />
              {tr("chapter.changelog.download")}
            </Button>
          </div>
        </div>
        <Card className="max-h-[40vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs">
          {markdown}
        </Card>
      </div>
    </div>
  );
};

export default CampaignChaptersDetail;
