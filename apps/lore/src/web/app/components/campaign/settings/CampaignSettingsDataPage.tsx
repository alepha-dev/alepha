import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Database, Download } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { CampaignQuestPortabilityController } from "@/api/controllers/CampaignQuestPortabilityController.ts";
import type { ImportResult } from "@/api/schemas/questImportRow.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignSettingsImportDetailsModal, {
  type ImportIssue,
} from "./CampaignSettingsImportDetailsModal.tsx";

const CampaignSettingsDataPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const api = useClient<CampaignQuestPortabilityController>();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [details, setDetails] = useState<{
    errors: ImportIssue[];
    warnings: ImportIssue[];
  } | null>(null);

  if (!campaign) return null;

  const handleExport = async () => {
    try {
      const file = await api.exportQuests({ params: { id: campaign.id } });
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
      toast.error(
        err instanceof Error
          ? err.message
          : String(tr("campaign.settings.data.import.error.title")),
      );
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const result = (await api.importQuests({
        params: { id: campaign.id },
        body: { file },
      })) as ImportResult;
      const msg = String(
        tr("campaign.settings.data.import.result", {
          args: [
            String(result.created),
            String(result.updated),
            String(result.skipped),
          ],
        }),
      );
      const hasDetails = result.errors.length > 0 || result.warnings.length > 0;
      toast.success(msg, {
        action: hasDetails
          ? {
              label: String(tr("campaign.settings.data.import.details")),
              onClick: () =>
                setDetails({
                  errors: result.errors,
                  warnings: result.warnings,
                }),
            }
          : undefined,
      });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : String(tr("campaign.settings.data.import.error.title")),
      );
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Database className="size-4" />
        <h2 className="text-sm font-medium">
          {tr("campaign.settings.data.title")}
        </h2>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {tr("campaign.settings.data.export.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("campaign.settings.data.export.subtitle")}
            </span>
          </div>
          <Button onClick={handleExport}>
            <Download className="size-4" />
            {tr("campaign.settings.data.export.button")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {tr("campaign.settings.data.import.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("campaign.settings.data.import.subtitle")}
            </span>
          </div>
          <Input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
          <span className="text-muted-foreground text-xs">
            {importing
              ? tr("campaign.settings.data.import.submitting")
              : tr("campaign.settings.data.import.dropzone")}
          </span>
        </CardContent>
      </Card>

      {details && (
        <CampaignSettingsImportDetailsModal
          open
          onOpenChange={(open) => !open && setDetails(null)}
          errors={details.errors}
          warnings={details.warnings}
        />
      )}
    </div>
  );
};

export default CampaignSettingsDataPage;
