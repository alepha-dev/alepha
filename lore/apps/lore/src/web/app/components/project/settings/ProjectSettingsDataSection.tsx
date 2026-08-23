import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Download, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import type { ProjectQuestPortabilityController } from "@/api/controllers/ProjectQuestPortabilityController.ts";
import type { ImportResult } from "@/api/schemas/questImportRow.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ProjectSettingsImportDetailsModal, {
  type ImportIssue,
} from "./ProjectSettingsImportDetailsModal.tsx";

/**
 * Data section: export + import quests as CSV. Rendered inside the General
 * settings page next to the project edit form and the danger zone, sharing
 * their visual pattern (border, no shadow, multiple rows separated by
 * `divide-y` inside a single Card).
 */
const ProjectSettingsDataSection = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<ProjectQuestPortabilityController>();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<{
    file: File;
    rowCount: number;
  } | null>(null);
  const [details, setDetails] = useState<{
    errors: ImportIssue[];
    warnings: ImportIssue[];
  } | null>(null);

  if (!project) return null;

  const handleExport = async () => {
    try {
      const file = await api.exportQuests({ params: { id: project.id } });
      const url = window.URL.createObjectURL(
        new Blob([await file.text()], { type: "text/csv" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toaster.error(
        err instanceof Error
          ? err.message
          : tr("project.settings.data.import.error.title"),
      );
    }
  };

  /**
   * Count data rows without committing — quick client-side parse so the
   * preview dialog can show "N rows will be imported". Format validation
   * happens on the actual import call.
   */
  const countRows = (text: string): number => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return Math.max(0, lines.length - 1);
  };

  const openFilePicker = () => fileInput.current?.click();

  const handleFilePicked = async (file: File) => {
    setPreparing(true);
    try {
      const text = await file.text();
      const rowCount = countRows(text);
      setPreview({ file, rowCount });
    } catch (err) {
      toaster.error(
        err instanceof Error
          ? err.message
          : tr("project.settings.data.import.error.title"),
      );
    } finally {
      setPreparing(false);
      // Reset input so picking the same file twice re-fires `change`.
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleConfirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const result = (await api.importQuests({
        params: { id: project.id },
        body: { file: preview.file },
      })) as ImportResult;
      const msg = String(
        tr("project.settings.data.import.result", {
          args: [
            String(result.created),
            String(result.updated),
            String(result.skipped),
          ],
        }),
      );
      const hasDetails = result.errors.length > 0 || result.warnings.length > 0;
      toaster.success(msg, {
        action: hasDetails
          ? {
              label: tr("project.settings.data.import.details"),
              onClick: () =>
                setDetails({
                  errors: result.errors,
                  warnings: result.warnings,
                }),
            }
          : undefined,
      });
      setPreview(null);
    } catch (err) {
      toaster.error(
        err instanceof Error
          ? err.message
          : tr("project.settings.data.import.error.title"),
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">{tr("project.settings.data.title")}</span>
      <Card className={cn(settingsCardEdge, "gap-0 divide-y py-0")}>
        <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {tr("project.settings.data.export.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("project.settings.data.export.subtitle")}
            </span>
          </div>
          <div className="flex justify-start sm:justify-end">
            <Button onClick={handleExport}>
              <Download className="size-4" />
              {tr("project.settings.data.export.button")}
            </Button>
          </div>
        </CardContent>

        <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {tr("project.settings.data.import.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("project.settings.data.import.subtitle")}
            </span>
          </div>
          <div className="flex justify-start sm:justify-end">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFilePicked(file);
              }}
            />
            <Button
              onClick={openFilePicker}
              disabled={preparing || importing}
              variant="outline"
            >
              {preparing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {tr("project.settings.data.import.choose")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !importing) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("project.settings.data.import.preview.title")}
            </DialogTitle>
            <DialogDescription>
              {preview && preview.rowCount > 0
                ? tr("project.settings.data.import.preview.body", {
                    args: [String(preview.rowCount), preview.file.name],
                  })
                : tr("project.settings.data.import.preview.empty")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPreview(null)}
              disabled={importing}
            >
              {tr("project.settings.data.import.preview.cancel")}
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={importing || !preview || preview.rowCount === 0}
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {tr("project.settings.data.import.preview.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {details && (
        <ProjectSettingsImportDetailsModal
          open
          onOpenChange={(open) => !open && setDetails(null)}
          errors={details.errors}
          warnings={details.warnings}
        />
      )}
    </div>
  );
};

export default ProjectSettingsDataSection;
