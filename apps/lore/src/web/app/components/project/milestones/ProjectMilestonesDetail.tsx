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

import type { MilestoneController } from "@/api/controllers/MilestoneController.ts";
import type { Milestone } from "@/api/entities/milestones.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import MilestoneTagInput from "./MilestoneTagInput.tsx";

export interface ProjectMilestonesDetailProps {
  milestone: Milestone;
  onUpdated: (milestone: Milestone) => void;
}

const ProjectMilestonesDetail = (props: ProjectMilestonesDetailProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<MilestoneController>();
  const [title, setTitle] = useState(props.milestone.title);
  const [description, setDescription] = useState(props.milestone.description);
  const [tags, setTags] = useState<string[]>(props.milestone.tags ?? []);
  const [markdown, setMarkdown] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await api.getMilestoneChangelog({
        params: { id: props.milestone.id },
      });
      if (!cancelled) setMarkdown(result.markdown);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.milestone.id]);

  const dirty =
    title !== props.milestone.title ||
    description !== props.milestone.description ||
    JSON.stringify(tags) !== JSON.stringify(props.milestone.tags ?? []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateMilestone({
        params: { id: props.milestone.id },
        body: { title, description, tags },
      });
      props.onUpdated(updated);
      toaster.success(tr("milestone.detail.saved"));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    toaster.success(tr("milestone.changelog.copied"));
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `milestone-${props.milestone.number}-changelog.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">#{props.milestone.number}</Badge>
        {props.milestone.closedAt && (
          <Badge variant="outline">{tr("milestone.status.closed")}</Badge>
        )}
        {!props.milestone.closedAt && (
          <Badge className="bg-green-600 text-white">
            {tr("milestone.status.active")}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("milestone.detail.editTitle")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("milestone.detail.editDescription")}</Label>
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("milestone.tags")}</Label>
        <MilestoneTagInput value={tags} onChange={setTags} />
      </div>

      <Button onClick={handleSave} disabled={!dirty || saving}>
        <Save className="size-4" />
        {tr("milestone.detail.save")}
      </Button>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>{tr("milestone.changelog")}</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="size-3.5" />
              {tr("milestone.changelog.copy")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="size-3.5" />
              {tr("milestone.changelog.download")}
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

export default ProjectMilestonesDetail;
