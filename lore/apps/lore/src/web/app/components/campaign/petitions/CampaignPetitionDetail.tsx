import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ExternalLink, Paperclip, Plus } from "lucide-react";
import { Fragment, useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { PetitionResource } from "@/api/schemas/petitionResourceSchema.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import QuestCreate from "../quest/QuestCreate.tsx";

export interface CampaignPetitionDetailProps {
  petition: PetitionResource;
  onChanged: () => void;
  onBack?: () => void;
}

const CampaignPetitionDetail = (props: CampaignPetitionDetailProps) => {
  const { petition } = props;
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const petitionApi = useClient<PetitionController>();
  const router = useRouter<AppRouter>();
  const toaster = useToast();
  const dialog = useDialog();

  const [busy, setBusy] = useState(false);
  const [questCreateOpen, setQuestCreateOpen] = useState(false);

  if (!campaign) return null;

  const handlePromote = async () => {
    setBusy(true);
    try {
      if (petition.status === "pending") {
        await petitionApi.acceptPetition({
          params: { campaignId: campaign.id, petitionId: petition.id },
        });
        toaster.show(tr("petitions.acceptedToast"), "success");
      }
      setQuestCreateOpen(true);
    } catch (err: any) {
      toaster.show(err?.message ?? tr("petitions.acceptError"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const handleQuestCreated = () => {
    setQuestCreateOpen(false);
    props.onChanged();
  };

  const handleReject = async () => {
    setBusy(true);
    try {
      await petitionApi.rejectPetition({
        params: { campaignId: campaign.id, petitionId: petition.id },
      });
      toaster.show(tr("petitions.rejected"), "success");
      props.onChanged();
    } catch (err: any) {
      toaster.show(err?.message ?? tr("petitions.rejectError"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = await dialog.confirm({
      title: tr("petitions.deleteConfirmTitle"),
      description: tr("petitions.deleteConfirm"),
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await petitionApi.removePetition({
        params: { campaignId: campaign.id, petitionId: petition.id },
      });
      toaster.show(tr("petitions.deleted"), "success");
      props.onChanged();
    } catch (err: any) {
      toaster.show(err?.message ?? tr("petitions.deleteError"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const linkedQuests = petition.linkedQuests ?? [];
  const tags = petition.tags ?? [];

  const questStatusColor: Record<string, string> = {
    new: "bg-slate-500/20 text-slate-300",
    accepted: "bg-amber-500/20 text-amber-300",
    completed: "bg-emerald-500/20 text-emerald-300",
    shelved: "bg-muted text-muted-foreground",
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border flex items-start gap-3 border-b p-4">
        {props.onBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onBack}
            className="md:hidden"
          >
            {tr("petitions.back")}
          </Button>
        )}
        <h2 className="flex-1 text-base font-semibold">{petition.title}</h2>
        <Badge variant="secondary" className="uppercase">
          {petition.status}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="font-mono text-[11px]"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <section>
          <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
            {tr("petitions.description")}
          </h3>
          <p className="whitespace-pre-wrap text-sm">{petition.description}</p>
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
                          shortId: String(q.shortId),
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

        {(petition.reporter || petition.source) && (
          <section className="bg-muted/30 rounded border border-border p-3 text-xs">
            <h3 className="text-muted-foreground mb-2 font-medium uppercase tracking-wide">
              {tr("petitions.context.title")}
            </h3>
            {/* Provenance fields are attacker-controlled — rendered as escaped
                plain text only (never as links/markdown). See folio #12. */}
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
              {petition.source &&
                (
                  [
                    ["petitions.context.page", petition.source.hostUrl],
                    ["petitions.context.title2", petition.source.title],
                    ["petitions.context.referrer", petition.source.referrer],
                    ["petitions.context.userAgent", petition.source.userAgent],
                    ["petitions.context.language", petition.source.language],
                    ["petitions.context.viewport", petition.source.viewport],
                    ["petitions.context.screen", petition.source.screen],
                    ["petitions.context.timezone", petition.source.timezone],
                  ] as const
                )
                  .filter(([, value]) => !!value)
                  .map(([labelKey, value]) => (
                    <Fragment key={labelKey}>
                      <dt className="text-muted-foreground">{tr(labelKey)}</dt>
                      <dd className="break-all">{value}</dd>
                    </Fragment>
                  ))}
            </dl>
          </section>
        )}
      </div>

      {petition.status === "pending" && (
        <div className="border-border flex flex-wrap justify-end gap-2 border-t p-3">
          <Button variant="ghost" onClick={handleDelete} disabled={busy}>
            {tr("petitions.delete")}
          </Button>
          <Button variant="outline" onClick={handleReject} disabled={busy}>
            {tr("petitions.reject")}
          </Button>
          <Button
            onClick={handlePromote}
            disabled={busy}
            data-testid="petition-accept-button"
          >
            <Plus className="size-4" />
            {tr("petitions.promote")}
          </Button>
        </div>
      )}

      {petition.status === "accepted" && (
        <div className="border-border flex flex-wrap justify-end gap-2 border-t p-3">
          <Button variant="ghost" onClick={handleDelete} disabled={busy}>
            {tr("petitions.delete")}
          </Button>
          <Button onClick={handlePromote} disabled={busy}>
            <Plus className="size-4" />
            {tr("petitions.createQuest")}
          </Button>
        </div>
      )}

      {petition.status === "rejected" && (
        <div className="border-border flex justify-end gap-2 border-t p-3">
          <Button variant="ghost" onClick={handleDelete} disabled={busy}>
            {tr("petitions.delete")}
          </Button>
        </div>
      )}

      <Sheet open={questCreateOpen} onOpenChange={setQuestCreateOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-[50vw]"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{tr("petitions.createQuest")}</SheetTitle>
          </SheetHeader>
          <QuestCreate
            campaign={campaign}
            quest={{
              title: petition.title,
              description: petition.description,
              petitionId: petition.id,
            }}
            onSubmit={handleQuestCreated}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default CampaignPetitionDetail;
