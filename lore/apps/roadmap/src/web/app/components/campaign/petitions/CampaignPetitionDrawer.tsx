import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Bug, ExternalLink, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { BeaconController } from "@/api/controllers/BeaconController.ts";
import type { BeaconResource } from "@/api/schemas/beaconResourceSchema.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { Toaster } from "../../../services/Toaster.ts";
import CampaignBeaconPromoteForm from "./CampaignBeaconPromoteForm.tsx";

export interface CampaignBeaconDrawerProps {
  beacon: BeaconResource | null;
  onClose: () => void;
  onChanged: () => void;
}

const CampaignBeaconDrawer = (props: CampaignBeaconDrawerProps) => {
  const { beacon } = props;
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const beaconApi = useClient<BeaconController>();
  const router = useRouter<AppRouter>();
  const toaster = useInject(Toaster);

  const [promoting, setPromoting] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset the inline promote form whenever the drawer opens a different beacon.
  useEffect(() => {
    setPromoting(false);
  }, [beacon?.id]);

  if (!beacon || !campaign) {
    return (
      <Sheet open={false} onOpenChange={(open) => !open && props.onClose()}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-2xl" />
      </Sheet>
    );
  }

  const Icon = beacon.reportType === "bug" ? Bug : Sparkles;
  const iconColor =
    beacon.reportType === "bug" ? "text-red-500" : "text-emerald-500";

  const handleDiscard = async () => {
    setBusy(true);
    try {
      await beaconApi.discard({
        params: { campaignId: campaign.id, beaconId: beacon.id },
      });
      toaster.show(String(tr("beacons.discarded")), "success");
      props.onChanged();
    } catch (err: any) {
      toaster.show(
        err?.message ?? String(tr("beacons.discardError")),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(String(tr("beacons.deleteConfirm")))
    ) {
      return;
    }
    setBusy(true);
    try {
      await beaconApi.remove({
        params: { campaignId: campaign.id, beaconId: beacon.id },
      });
      toaster.show(String(tr("beacons.deleted")), "success");
      props.onChanged();
    } catch (err: any) {
      toaster.show(err?.message ?? String(tr("beacons.deleteError")), "danger");
    } finally {
      setBusy(false);
    }
  };

  const questHref =
    beacon.promotedQuestId != null
      ? router.path("campaignQuest", {
          params: {
            campaignId: String(campaign.id),
            questId: String(beacon.promotedQuestId),
          },
        })
      : undefined;

  return (
    <Sheet open={true} onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-border border-b">
          <div className="flex items-start gap-3">
            <Icon className={`size-5 shrink-0 ${iconColor} mt-0.5`} />
            <SheetTitle className="flex-1 text-left text-base">
              {beacon.title}
            </SheetTitle>
            <Badge variant="secondary" className="uppercase">
              {beacon.status}
            </Badge>
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-4">
          {beacon.status === "promoted" && questHref && (
            <a
              href={questHref}
              className="text-emerald-500 inline-flex items-center gap-1.5 text-sm hover:underline"
            >
              <ExternalLink className="size-3.5" />
              {tr("beacons.promoted", {
                args: [String(beacon.promotedQuestId)],
              })}
            </a>
          )}

          <section>
            <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
              {tr("beacons.description")}
            </h3>
            <p className="whitespace-pre-wrap text-sm">{beacon.description}</p>
          </section>

          {beacon.screenshotUrl && (
            <section>
              <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                {tr("beacons.screenshot")}
              </h3>
              <a href={beacon.screenshotUrl} target="_blank" rel="noreferrer">
                <img
                  src={beacon.screenshotUrl}
                  alt={String(tr("beacons.screenshot"))}
                  className="border-border max-h-96 w-full rounded border object-contain"
                />
              </a>
            </section>
          )}

          <section className="bg-muted/30 rounded border border-border p-3 text-xs">
            <h3 className="text-muted-foreground mb-2 font-medium uppercase tracking-wide">
              {tr("beacons.context.title")}
            </h3>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">
                {tr("beacons.context.url")}
              </dt>
              <dd className="break-all">{beacon.context.url}</dd>
              <dt className="text-muted-foreground">
                {tr("beacons.context.path")}
              </dt>
              <dd className="break-all">{beacon.context.path}</dd>
              <dt className="text-muted-foreground">
                {tr("beacons.context.userAgent")}
              </dt>
              <dd className="break-all">{beacon.context.userAgent}</dd>
              <dt className="text-muted-foreground">
                {tr("beacons.context.viewport")}
              </dt>
              <dd>
                {beacon.context.viewport.width}×{beacon.context.viewport.height}
              </dd>
              {beacon.context.locale && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("beacons.context.locale")}
                  </dt>
                  <dd>{beacon.context.locale}</dd>
                </>
              )}
              {beacon.context.referrer && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("beacons.context.referrer")}
                  </dt>
                  <dd className="break-all">{beacon.context.referrer}</dd>
                </>
              )}
              {beacon.reporterEmail && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("beacons.context.reporter")}
                  </dt>
                  <dd>{beacon.reporterEmail}</dd>
                </>
              )}
            </dl>
          </section>

          {beacon.status === "new" && promoting && (
            <CampaignBeaconPromoteForm
              beacon={beacon}
              onCancel={() => setPromoting(false)}
              onPromoted={() => {
                toaster.show(String(tr("beacons.promotedToast")), "success");
                props.onChanged();
              }}
            />
          )}

          {beacon.status === "new" && !promoting && (
            <div className="flex flex-wrap justify-end gap-2 border-border border-t pt-3">
              <Button variant="ghost" onClick={handleDelete} disabled={busy}>
                {tr("beacons.delete")}
              </Button>
              <Button variant="outline" onClick={handleDiscard} disabled={busy}>
                {tr("beacons.discard")}
              </Button>
              <Button onClick={() => setPromoting(true)} disabled={busy}>
                {tr("beacons.promote")}
              </Button>
            </div>
          )}

          {beacon.status !== "new" && (
            <div className="flex justify-end gap-2 border-border border-t pt-3">
              <Button variant="ghost" onClick={handleDelete} disabled={busy}>
                {tr("beacons.delete")}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CampaignBeaconDrawer;
