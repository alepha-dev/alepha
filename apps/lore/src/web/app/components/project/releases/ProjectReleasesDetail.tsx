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

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { Release } from "@/api/entities/releases.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ReleaseTagInput from "./ReleaseTagInput.tsx";

export interface ProjectReleasesDetailProps {
  release: Release;
  onUpdated: (release: Release) => void;
}

const ProjectReleasesDetail = (props: ProjectReleasesDetailProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<ReleaseController>();
  const [title, setTitle] = useState(props.release.title);
  const [description, setDescription] = useState(props.release.description);
  const [tags, setTags] = useState<string[]>(props.release.tags ?? []);
  const [markdown, setMarkdown] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.getReleaseChangelog({
          params: { id: props.release.id },
        });
        if (!cancelled) setMarkdown(result.markdown);
      } catch {
        // `markdown` stays empty, which is what the Copy and Download
        // controls key off — without this the rejection was unhandled and
        // both stayed live over nothing.
        if (!cancelled) toaster.error(tr("release.changelog.error"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.release.id]);

  const dirty =
    title !== props.release.title ||
    description !== props.release.description ||
    JSON.stringify(tags) !== JSON.stringify(props.release.tags ?? []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateRelease({
        params: { id: props.release.id },
        body: { title, description, tags },
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      toaster.success(tr("release.changelog.copied"));
    } catch {
      // The clipboard rejects on a page without focus or permission, and the
      // "copied" toast was firing regardless.
      toaster.error(tr("release.changelog.copyError"));
    }
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `release-${props.release.number}-changelog.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">#{props.release.number}</Badge>
        {props.release.closedAt && (
          <Badge variant="outline">{tr("release.status.closed")}</Badge>
        )}
        {!props.release.closedAt && (
          <Badge className="bg-green-600 text-white">
            {tr("release.status.active")}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("release.detail.editTitle")}</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("release.detail.editDescription")}</Label>
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{tr("release.tags")}</Label>
        <ReleaseTagInput value={tags} onChange={setTags} />
      </div>

      <Button onClick={handleSave} disabled={!dirty || saving}>
        <Save className="size-4" />
        {tr("release.detail.save")}
      </Button>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>{tr("release.changelog")}</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="size-3.5" />
              {tr("release.changelog.copy")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="size-3.5" />
              {tr("release.changelog.download")}
            </Button>
          </div>
        </div>
        <Card className="max-h-[40vh] overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">
          {markdown}
        </Card>
      </div>
    </div>
  );
};

export default ProjectReleasesDetail;
