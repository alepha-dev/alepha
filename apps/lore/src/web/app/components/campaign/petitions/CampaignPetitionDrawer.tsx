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
import { Bug, ExternalLink, Paperclip, Sparkles } from "lucide-react";
import { useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { PetitionResource } from "@/api/schemas/petitionResourceSchema.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { Toaster } from "../../../services/Toaster.ts";

export interface CampaignPetitionDrawerProps {
  petition: PetitionResource | null;
  onClose: () => void;
  onChanged: () => void;
}

const CampaignPetitionDrawer = (props: CampaignPetitionDrawerProps) => {
  const { petition } = props;
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const petitionApi = useClient<PetitionController>();
  const router = useRouter<AppRouter>();
  const toaster = useInject(Toaster);

  const [busy, setBusy] = useState(false);

  if (!petition || !campaign) {
    return (
      <Sheet open={false} onOpenChange={(open) => !open && props.onClose()}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-2xl" />
      </Sheet>
    );
  }

  const Icon = petition.reportType === "bug" ? Bug : Sparkles;
  const iconColor =
    petition.reportType === "bug" ? "text-red-500" : "text-emerald-500";

  const handleAccept = async () => {
    setBusy(true);
    try {
      await petitionApi.acceptPetition({
        params: { campaignId: campaign.id, petitionId: petition.id },
      });
      toaster.show(String(tr("petitions.acceptedToast")), "success");
      props.onChanged();
    } catch (err: any) {
      toaster.show(
        err?.message ?? String(tr("petitions.acceptError")),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    setBusy(true);
    try {
      await petitionApi.rejectPetition({
        params: { campaignId: campaign.id, petitionId: petition.id },
      });
      toaster.show(String(tr("petitions.rejected")), "success");
      props.onChanged();
    } catch (err: any) {
      toaster.show(
        err?.message ?? String(tr("petitions.rejectError")),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(String(tr("petitions.deleteConfirm")))
    ) {
      return;
    }
    setBusy(true);
    try {
      await petitionApi.removePetition({
        params: { campaignId: campaign.id, petitionId: petition.id },
      });
      toaster.show(String(tr("petitions.deleted")), "success");
      props.onChanged();
    } catch (err: any) {
      toaster.show(
        err?.message ?? String(tr("petitions.deleteError")),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  };

  const linkedQuests = petition.linkedQuests ?? [];

  const questStatusColor: Record<string, string> = {
    new: "bg-slate-500/20 text-slate-300",
    accepted: "bg-amber-500/20 text-amber-300",
    completed: "bg-emerald-500/20 text-emerald-300",
  };

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
              {petition.title}
            </SheetTitle>
            <Badge variant="secondary" className="uppercase">
              {petition.status}
            </Badge>
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-4">
          <section>
            <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
              {tr("petitions.description")}
            </h3>
            <p className="whitespace-pre-wrap text-sm">
              {petition.description}
            </p>
          </section>

          {petition.attachmentUrls && petition.attachmentUrls.length > 0 && (
            <section>
              <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                {tr("petitions.attachments")}
              </h3>
              <ul className="flex flex-col gap-1">
                {petition.attachmentUrls.map((a) => (
                  <li key={a.id}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm hover:underline"
                    >
                      <Paperclip className="size-3.5" />
                      <span className="truncate">{a.name}</span>
                      <span className="text-muted-foreground text-xs">
                        ({Math.round(a.size / 1024)} KB)
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {petition.status === "accepted" && (
            <section data-testid="petition-linked-quests">
              <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                {tr("petitions.linkedQuests")}
              </h3>
              {linkedQuests.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {tr("petitions.noLinkedQuests")}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {linkedQuests.map((q) => (
                    <li key={q.id}>
                      <a
                        href={router.path("campaignQuest", {
                          params: {
                            campaignId: String(campaign.id),
                            questId: String(q.id),
                          },
                        })}
                        className="bg-muted/30 hover:bg-muted/60 flex items-center gap-2 rounded border border-border px-3 py-2 text-sm"
                        data-testid={`linked-quest-${q.id}`}
                      >
                        <ExternalLink className="size-3.5" />
                        <span className="flex-1 truncate">{q.title}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                            questStatusColor[q.status] ?? ""
                          }`}
                        >
                          {q.status}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="bg-muted/30 rounded border border-border p-3 text-xs">
            <h3 className="text-muted-foreground mb-2 font-medium uppercase tracking-wide">
              {tr("petitions.context.title")}
            </h3>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              {petition.reporter && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("petitions.context.reporter")}
                  </dt>
                  <dd>
                    {petition.reporter.name ??
                      petition.reporter.username ??
                      petition.reporter.id}
                  </dd>
                </>
              )}
              {petition.context?.url && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("petitions.context.url")}
                  </dt>
                  <dd className="break-all">{petition.context.url}</dd>
                </>
              )}
              {petition.context?.path && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("petitions.context.path")}
                  </dt>
                  <dd className="break-all">{petition.context.path}</dd>
                </>
              )}
            </dl>
          </section>

          {petition.status === "pending" && (
            <div className="flex flex-wrap justify-end gap-2 border-border border-t pt-3">
              <Button variant="ghost" onClick={handleDelete} disabled={busy}>
                {tr("petitions.delete")}
              </Button>
              <Button variant="outline" onClick={handleReject} disabled={busy}>
                {tr("petitions.reject")}
              </Button>
              <Button
                onClick={handleAccept}
                disabled={busy}
                data-testid="petition-accept-button"
              >
                {tr("petitions.accept")}
              </Button>
            </div>
          )}

          {petition.status !== "pending" && (
            <div className="flex justify-end gap-2 border-border border-t pt-3">
              <Button variant="ghost" onClick={handleDelete} disabled={busy}>
                {tr("petitions.delete")}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CampaignPetitionDrawer;
