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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@alepha/ui/components/ui/hover-card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { HelpCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  SigilController,
  SigilResource,
} from "@/api/controllers/SigilController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import SigilFormDialog, { type SigilFormValue } from "./SigilFormDialog.tsx";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

const CampaignSettingsSigilsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const sigilApi = useClient<SigilController>();
  const [campaign] = useStore(currentCampaignAtom);
  const { enabled, toggle } = useCampaignFeatureToggle("sigils");

  // Campaign-level feature flags that gate each sigil `kind`.
  const embeddedPetitions = useCampaignFeatureToggle("embeddedPetitions");
  const blights = useCampaignFeatureToggle("blights");
  const beacon = useCampaignFeatureToggle("beacon");
  const featureEnabled: Record<string, boolean> = {
    embeddedPetitions: embeddedPetitions.enabled,
    blights: blights.enabled,
    beacon: beacon.enabled,
  };
  // `petitions` is a required base feature key in `campaignFeaturesSchema`
  // — embedded petitions need it ON as well as the parent `sigils` feature.
  const petitionsEnabled = campaign?.features?.petitions ?? false;

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
        toaster.success(String(tr("sigils.toast.updated")));
      } else {
        await sigilApi.createSigil({
          params: { campaignId: campaign.id },
          body: value,
        });
        toaster.success(String(tr("sigils.toast.created")));
      }
      setDialogSigil(undefined);
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const copySnippet = (sigil: SigilResource) => {
    const snippet = `<script src="${origin}/sigils/${sigil.id}/embed.js"></script>`;
    void navigator.clipboard.writeText(snippet);
    toaster.success(String(tr("sigils.toast.copied")));
  };

  const rotateKey = async (sigil: SigilResource) => {
    if (!campaign) return;
    try {
      await sigilApi.rotateSigilKey({
        params: { campaignId: campaign.id, id: sigil.id },
      });
      // No reload(): rotating only swaps the server-side secret —
      // nothing list-visible (label, origins, kinds) changes.
      toaster.success(String(tr("sigils.toast.rotated")));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmDelete = async () => {
    if (!campaign || !deleteTarget) return;
    try {
      await sigilApi.deleteSigil({
        params: { campaignId: campaign.id, id: deleteTarget.id },
      });
      toaster.success(String(tr("sigils.toast.deleted")));
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
      {/* One merged Features card — master Sigils toggle, then the
          per-capability sub-toggles grouped inside it (mirrors the Quests
          settings feature card). Sub-toggles are disabled when the master
          `sigils` feature is OFF; the Petitions sub-toggle additionally
          needs the base `petitions` module ON. */}
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
          {/* Master Sigils toggle. */}
          <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {tr("campaign.settings.nav.sigils")}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr("campaign.settings.feature.sigils.description")}
              </span>
            </div>
            <div className="flex justify-start sm:justify-end">
              <Switch
                checked={enabled}
                onCheckedChange={(value) => {
                  void toggle(value === true);
                }}
                aria-label={String(tr("campaign.settings.nav.sigils"))}
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
                disabled={!enabled}
                onCheckedChange={(value) => {
                  void blights.toggle(value === true);
                }}
                aria-label={String(tr("blights.feature.title"))}
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
                disabled={!enabled}
                onCheckedChange={(value) => {
                  void beacon.toggle(value === true);
                }}
                aria-label={String(tr("beacon.feature.title"))}
              />
            </div>
          </CardContent>

          {/* Petitions sub-toggle. Needs BOTH the parent `sigils` feature
              AND the base `petitions` module ON; the helper line explains
              the `petitions` precondition when it is missing. */}
          <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {tr("embeddedPetitions.feature.title")}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr("embeddedPetitions.feature.description")}
              </span>
              {enabled && !petitionsEnabled && (
                <span className="text-muted-foreground text-xs">
                  {tr("embeddedPetitions.feature.requiresPetitions")}
                </span>
              )}
            </div>
            <div className="flex justify-start sm:justify-end">
              <Switch
                checked={embeddedPetitions.enabled}
                disabled={!enabled || !petitionsEnabled}
                onCheckedChange={(value) => {
                  void embeddedPetitions.toggle(value === true);
                }}
                aria-label={String(tr("embeddedPetitions.feature.title"))}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {enabled && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{tr("sigils.title")}</span>
              <span className="text-muted-foreground text-xs">
                {tr("sigils.subtitle")}
              </span>
            </div>
            <Button onClick={() => setDialogSigil(null)}>
              {tr("sigils.action.new")}
            </Button>
          </div>

          {/* Sigil list */}
          {sigils.length === 0 ? (
            <span className="text-muted-foreground text-sm">
              {tr("sigils.empty")}
            </span>
          ) : (
            <div className="flex flex-col gap-3">
              {sigils.map((sigil) => (
                <Card key={sigil.id} className="py-4 shadow">
                  <CardContent className="flex flex-col gap-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{sigil.label}</span>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-xs">
                        {tr("sigils.card.origins")}
                      </span>
                      {sigil.allowedOrigins.length === 0 ? (
                        <span className="text-muted-foreground text-xs">
                          {tr("sigils.card.noOrigins")}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {sigil.allowedOrigins.map((o) => (
                            <Badge key={o} variant="secondary">
                              {o}
                            </Badge>
                          ))}
                        </div>
                      )}
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
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void rotateKey(sigil)}
                        >
                          {tr("sigils.action.rotateKey")}
                        </Button>
                        <HoverCard>
                          <HoverCardTrigger
                            render={
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={String(tr("sigils.rotateKey.help"))}
                              />
                            }
                          >
                            <HelpCircle className="size-4" aria-hidden />
                          </HoverCardTrigger>
                          <HoverCardContent className="text-xs">
                            {tr("sigils.rotateKey.help")}
                          </HoverCardContent>
                        </HoverCard>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteTarget(sigil)}
                      >
                        {tr("sigils.action.delete")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
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
