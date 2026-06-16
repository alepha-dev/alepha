import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alepha/ui/components/ui/alert-dialog";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  SigilController,
  SigilResource,
} from "@/api/controllers/SigilController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignSettingsFeatureSection from "./CampaignSettingsFeatureSection.tsx";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

const CampaignSettingsSigilsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const sigilApi = useClient<SigilController>();
  const [campaign] = useStore(currentCampaignAtom);
  const { enabled, toggle } = useCampaignFeatureToggle("sigils");

  // Campaign-level feature gates — the server-side authorization that decides
  // what each sigil's ingest endpoint accepts. (Which capabilities a given
  // partner app actually runs is chosen there via `SIGIL_FEATURES`.)
  const petitions = useCampaignFeatureToggle("petitions");
  const blights = useCampaignFeatureToggle("blights");
  const beacon = useCampaignFeatureToggle("beacon");
  const vitals = useCampaignFeatureToggle("vitals");

  const [sigils, setSigils] = useState<SigilResource[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<SigilResource | null>(null);

  const reload = useCallback(async () => {
    if (!campaign) return;
    try {
      const res = await sigilApi.listSigils({
        params: { campaignId: campaign.id },
      });
      setSigils(res.items);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  }, [campaign, sigilApi]);

  useEffect(() => {
    if (campaign && enabled) {
      void reload();
    }
  }, [campaign, enabled, reload]);

  const createSigil = async () => {
    if (!campaign) return;
    const label = await dialog.prompt({
      title: tr("sigils.action.new"),
      label: tr("sigils.create.label"),
      placeholder: tr("sigils.create.labelPlaceholder"),
      confirmLabel: tr("sigils.create.submit"),
    });
    if (!label?.trim()) return;
    try {
      await sigilApi.createSigil({
        params: { campaignId: campaign.id },
        body: { label: label.trim() },
      });
      toaster.success(tr("sigils.toast.created"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const copyId = (sigil: SigilResource) => {
    void navigator.clipboard.writeText(sigil.id);
    toaster.success(tr("sigils.toast.copied"));
  };

  const confirmDelete = async () => {
    if (!campaign || !deleteTarget) return;
    try {
      await sigilApi.deleteSigil({
        params: { campaignId: campaign.id, id: deleteTarget.id },
      });
      toaster.success(tr("sigils.toast.deleted"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleteTarget(null);
    }
  };

  if (!campaign) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* Master Sigils toggle — same pattern as Petitions / Folios / Kanban. */}
      <CampaignSettingsFeatureSection
        featureKey="sigils"
        enabled={enabled}
        onToggle={toggle}
      />

      {/* Sub-feature blocks — only shown when the master toggle is ON. */}
      {enabled && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              {tr("sigils.features.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("sigils.features.subtitle")}
            </span>
          </div>

          <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
            {/* Petitions sub-toggle. */}
            <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("petitions.feature.title")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("petitions.feature.description")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Switch
                  checked={petitions.enabled}
                  onCheckedChange={(value) => {
                    void petitions.toggle(value === true);
                  }}
                  aria-label={tr("petitions.feature.title")}
                />
              </div>
            </CardContent>

            {/* Blights sub-toggle. */}
            <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("blights.feature.title")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("blights.feature.description")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Switch
                  checked={blights.enabled}
                  onCheckedChange={(value) => {
                    void blights.toggle(value === true);
                  }}
                  aria-label={tr("blights.feature.title")}
                />
              </div>
            </CardContent>

            {/* Beacons sub-toggle. */}
            <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("beacon.feature.title")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("beacon.feature.description")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Switch
                  checked={beacon.enabled}
                  onCheckedChange={(value) => {
                    void beacon.toggle(value === true);
                  }}
                  aria-label={tr("beacon.feature.title")}
                />
              </div>
            </CardContent>

            {/* Vitals sub-toggle. */}
            <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("vitals.feature.title")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("vitals.feature.description")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Switch
                  checked={vitals.enabled}
                  onCheckedChange={(value) => {
                    void vitals.toggle(value === true);
                  }}
                  aria-label={tr("vitals.feature.title")}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {enabled && (
        <div className="flex flex-col gap-4">
          <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
            {/* Header row: title + subtitle + add button */}
            <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {tr("sigils.title")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tr("sigils.subtitle")}
                </span>
              </div>
              <div className="flex justify-start sm:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void createSigil()}
                  aria-label={tr("sigils.action.new")}
                >
                  <Plus className="size-4" aria-hidden />
                </Button>
              </div>
            </CardContent>

            {/* Empty state — no sigils issued yet for this campaign. */}
            {sigils.length === 0 && (
              <CardContent className="px-4 py-3">
                <span className="text-muted-foreground text-xs">
                  {tr("sigils.empty")}
                </span>
              </CardContent>
            )}

            {/* Sigil rows — Name, UUID (copy), Delete. */}
            {sigils.map((sigil) => (
              <CardContent
                key={sigil.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {sigil.label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <code className="text-muted-foreground truncate font-mono text-xs">
                      {sigil.id}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      onClick={() => copyId(sigil)}
                      aria-label={tr("sigils.action.copyId")}
                    >
                      <Copy className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setDeleteTarget(sigil)}
                  aria-label={tr("sigils.action.delete")}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </CardContent>
            ))}
          </Card>
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("sigils.delete.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr("sigils.delete.confirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("sigils.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {tr("sigils.action.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CampaignSettingsSigilsPage;
