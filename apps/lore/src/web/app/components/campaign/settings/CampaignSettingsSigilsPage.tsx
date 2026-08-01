import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
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
import CampaignSettingsSigilRow from "./CampaignSettingsSigilRow.tsx";
import CampaignSettingsSigilToken from "./CampaignSettingsSigilToken.tsx";
import CampaignSettingsToggleRow from "./CampaignSettingsToggleRow.tsx";
import { useCampaignFeatureToggle } from "./useCampaignFeatureToggle.ts";

/**
 * Which applications report into this campaign, and what they may report.
 *
 * A sigil is **one environment of one application** — `lore` in `production` is
 * a different sigil from `lore` in `staging`, so the form asks for the two
 * separately instead of a free-form name that would let the same environment be
 * enrolled twice under different spellings.
 *
 * The token appears exactly once, at creation. It is stored hashed, so nothing
 * can show it again. The way back from a lost or leaked token is to rotate it,
 * which is offered beside delete precisely because delete is not the same
 * thing: the aggregate tables cascade, so deleting a sigil to revoke a token
 * also erases everything that environment ever reported.
 */
const CampaignSettingsSigilsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const sigilApi = useClient<SigilController>();
  const [campaign] = useStore(currentCampaignAtom);

  const master = useCampaignFeatureToggle("sigils");
  // What the ingest endpoint accepts, campaign-wide. Intersected with each
  // sigil's own `kinds` — these are the lever an operator actually reaches for.
  const petitions = useCampaignFeatureToggle("petitions");
  const blights = useCampaignFeatureToggle("blights");
  const beacon = useCampaignFeatureToggle("beacon");
  const vitals = useCampaignFeatureToggle("vitals");

  const [sigils, setSigils] = useState<SigilResource[]>([]);
  const [app, setApp] = useState("");
  const [environment, setEnvironment] = useState("");
  const [busy, setBusy] = useState(false);
  /** The one moment a token is readable. Cleared as soon as it is dismissed. */
  const [freshToken, setFreshToken] = useState<string | undefined>();

  const enabled = master.enabled;

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

  const create = async () => {
    if (!campaign || !app.trim() || !environment.trim()) return;
    setBusy(true);
    try {
      const created = await sigilApi.createSigil({
        params: { campaignId: campaign.id },
        body: { app: app.trim(), environment: environment.trim() },
      });
      setFreshToken(created.token);
      setApp("");
      setEnvironment("");
      toaster.success(tr("sigils.toast.created"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (sigil: SigilResource) => {
    if (!campaign) return;
    const confirmed = await dialog.confirm({
      title: tr("sigils.rotate.confirmTitle", { args: [sigil.label] }),
      description: tr("sigils.rotate.confirmDescription"),
      confirmLabel: tr("sigils.rotate.confirm"),
    });
    if (!confirmed) return;

    try {
      const rotated = await sigilApi.rotateSigil({
        params: { campaignId: campaign.id, sigilId: sigil.id },
      });
      setFreshToken(rotated.token);
      toaster.success(tr("sigils.toast.rotated"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (sigil: SigilResource) => {
    if (!campaign) return;
    const confirmed = await dialog.confirm({
      title: tr("sigils.delete.confirmTitle", { args: [sigil.label] }),
      description: tr("sigils.delete.confirmDescription"),
      confirmLabel: tr("sigils.delete.confirm"),
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await sigilApi.deleteSigil({
        params: { campaignId: campaign.id, sigilId: sigil.id },
      });
      toaster.success(tr("sigils.toast.deleted"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (!campaign) return null;

  return (
    <div className="flex flex-col gap-6">
      <CampaignSettingsFeatureSection
        featureKey="sigils"
        enabled={enabled}
        onToggle={master.toggle}
      />

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
            <CampaignSettingsToggleRow
              title={tr("petitions.feature.title")}
              description={tr("petitions.feature.description")}
              toggle={petitions}
            />
            <CampaignSettingsToggleRow
              title={tr("blights.feature.title")}
              description={tr("blights.feature.description")}
              toggle={blights}
            />
            <CampaignSettingsToggleRow
              title={tr("beacon.feature.title")}
              description={tr("beacon.feature.description")}
              toggle={beacon}
            />
            <CampaignSettingsToggleRow
              title={tr("vitals.feature.title")}
              description={tr("vitals.feature.description")}
              toggle={vitals}
            />
          </Card>
        </div>
      )}

      {enabled && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{tr("sigils.title")}</span>
            <span className="text-muted-foreground text-xs">
              {tr("sigils.subtitle")}
            </span>
          </div>

          {freshToken && (
            <CampaignSettingsSigilToken
              token={freshToken}
              onDismiss={() => setFreshToken(undefined)}
            />
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={app}
              aria-label={tr("sigils.create.app")}
              placeholder={tr("sigils.create.appPlaceholder")}
              onChange={(event) => setApp(event.target.value)}
            />
            <Input
              value={environment}
              aria-label={tr("sigils.create.environment")}
              placeholder={tr("sigils.create.environmentPlaceholder")}
              onChange={(event) => setEnvironment(event.target.value)}
            />
            <Button
              onClick={() => void create()}
              disabled={busy || !app.trim() || !environment.trim()}
            >
              <Plus />
              {tr("sigils.create.submit")}
            </Button>
          </div>

          <Card className="bg-card divide-y gap-0 rounded-lg border py-0">
            {sigils.length === 0 && (
              <CardContent className="px-4 py-6">
                <span className="text-muted-foreground text-sm">
                  {tr("sigils.empty")}
                </span>
              </CardContent>
            )}
            {sigils.map((sigil) => (
              <CampaignSettingsSigilRow
                key={sigil.id}
                sigil={sigil}
                onRotate={(target) => void rotate(target)}
                onDelete={(target) => void remove(target)}
              />
            ))}
          </Card>
        </div>
      )}
    </div>
  );
};

export default CampaignSettingsSigilsPage;
