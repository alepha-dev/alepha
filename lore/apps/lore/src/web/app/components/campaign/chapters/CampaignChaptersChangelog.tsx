import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import type { Chapter } from "@/api/entities/chapters.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface CampaignChaptersChangelogProps {
  markdown: string;
  chapter: Chapter;
}

const CampaignChaptersChangelog = (props: CampaignChaptersChangelogProps) => {
  const { tr } = useI18n<I18n, "en">();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.markdown);
    toast.success(String(tr("chapter.changelog.copied")));
  };

  const handleDownload = () => {
    const blob = new Blob([props.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chapter-${props.chapter.number}-changelog.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="size-3.5" />
          {tr("chapter.changelog.copy")}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="size-3.5" />
          {tr("chapter.changelog.download")}
        </Button>
      </div>
      <Card className="max-h-[60vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs">
        {props.markdown}
      </Card>
    </div>
  );
};

export default CampaignChaptersChangelog;
