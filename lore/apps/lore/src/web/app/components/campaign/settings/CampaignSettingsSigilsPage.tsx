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
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  SigilController,
  SigilResource,
} from "@/api/controllers/SigilController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import CampaignSettingsFeatureSection from "./CampaignSettingsFeatureSection.tsx";
import SigilFormDialog, { type SigilFormValue } from "./SigilFormDialog.tsx";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

const CampaignSettingsSigilsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const sigilApi = useClient<SigilController>();
  const [campaign] = useStore(currentCampaignAtom);
  const { enabled, toggle } = useCampaignFeatureToggle("sigils");

  // Campaign-level feature flags that gate each sigil `kind`.
  const petitions = useCampaignFeatureToggle("petitions");
  const blights = useCampaignFeatureToggle("blights");
  const beacon = useCampaignFeatureToggle("beacon");
  const vitals = useCampaignFeatureToggle("vitals");
  const featureEnabled: Record<string, boolean> = {
    petitions: petitions.enabled,
    blights: blights.enabled,
    beacon: beacon.enabled,
    vitals: vitals.enabled,
  };

  const [sigils, setSigils] = useState<SigilResource[]>([]);
  // `undefined` → dialog closed; `null` → create; a sigil → edit.
  const [dialogSigil, setDialogSigil] = useState<
    SigilResource | null | undefined
  >(undefined);
  const [deleteTarget, setDeleteTarget] = useState<SigilResource | null>(null);

  // During SSR there is no `window`; fall back to an empty origin so the
  // copy-snippet shows a relative `<script src>` — corrected to the real
  // origin once the page hydrates in the browser.
  const origin = typeof window !== "undefined" ? window.location.origin : "";

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

  const submitDialog = async (value: SigilFormValue) => {
    if (!campaign) return;
    try {
      if (dialogSigil) {
        await sigilApi.updateSigil({
          params: { campaignId: campaign.id, id: dialogSigil.id },
          body: value,
        });
        toaster.success(tr("sigils.toast.updated"));
      } else {
        await sigilApi.createSigil({
          params: { campaignId: campaign.id },
          body: value,
        });
        toaster.success(tr("sigils.toast.created"));
      }
      setDialogSigil(undefined);
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const copySnippet = (sigil: SigilResource) => {
    const snippet = `POST ${origin}/sigils/${sigil.id}/ingest`;
    void navigator.clipboard.writeText(snippet);
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
                  onClick={() => setDialogSigil(null)}
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

            {/* Sigil rows — each separated by the card's divide-y */}
            {sigils.map((sigil) => (
              <CardContent
                key={sigil.id}
                className="flex flex-col gap-3 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{sigil.label}</span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">
                    {tr("sigils.card.kinds")}
                  </span>
                  {sigil.kinds.length === 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {tr("sigils.card.noKinds")}
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {sigil.kinds.map((k) => (
                        <Badge key={k} variant="secondary">
                          {k}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copySnippet(sigil)}
                  >
                    {tr("sigils.action.copySnippet")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialogSigil(sigil)}
                  >
                    {tr("sigils.action.edit")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteTarget(sigil)}
                  >
                    {tr("sigils.action.delete")}
                  </Button>
                </div>
              </CardContent>
            ))}
          </Card>
        </div>
      )}

      <SigilFormDialog
        open={dialogSigil !== undefined}
        sigil={dialogSigil ?? undefined}
        featureEnabled={featureEnabled}
        onOpenChange={(open) => {
          if (!open) setDialogSigil(undefined);
        }}
        onSubmit={submitDialog}
      />

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
