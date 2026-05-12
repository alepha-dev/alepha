import { Badge } from "@alepha/ui/components/ui/badge";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { Bug, ExternalLink, Paperclip, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { PetitionResource } from "@/api/schemas/petitionResourceSchema.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import type { I18n } from "../../../services/I18n.ts";

const POLL_INTERVAL_MS = 10_000;

const QUEST_STATUS_COLOR: Record<string, string> = {
  new: "bg-slate-500/20 text-slate-300",
  accepted: "bg-amber-500/20 text-amber-300",
  completed: "bg-emerald-500/20 text-emerald-300",
};

const PETITION_STATUS_VARIANT: Record<
  string,
  "secondary" | "default" | "destructive"
> = {
  pending: "secondary",
  accepted: "default",
  rejected: "destructive",
};

/**
 * Reporter-facing petition status page.
 *
 * Mounted at `/c/:campaignId/p/:petitionId` (top-level, not nested under the
 * campaign layout) so reporters can land here without campaign membership.
 * Server-side, `getMine` only returns the petition if the caller is its
 * reporter or the campaign owner — anyone else gets a 404.
 *
 * Polls every 10s so the reporter sees quest-status changes without manual
 * refresh.
 */
const CampaignPetitionStatus = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const dt = useInject(DateTimeProvider);
  const petitionApi = useClient<PetitionController>();

  const campaignIdParam = String(routerState.params.campaignId);
  const petitionIdParam = String(routerState.params.petitionId);
  const campaignId = Number(campaignIdParam);
  const petitionId = Number(petitionIdParam);

  const [petition, setPetition] = useState<PetitionResource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const fresh = await petitionApi.getMyPetition({
          params: { campaignId, petitionId },
        });
        if (!cancelled) {
          setPetition(fresh);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? String(tr("petitions.status.error")));
        }
      }
    };

    load();
    const handle = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [campaignId, petitionId]);

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <Card className="shadow">
          <CardContent className="flex flex-col gap-3">
            <h1 className="text-lg font-semibold">
              {tr("petitions.status.unavailableTitle")}
            </h1>
            <p className="text-muted-foreground text-sm">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!petition) {
    return (
      <div className="mx-auto flex w-full max-w-2xl p-4">
        <p className="text-muted-foreground text-sm">
          {tr("petitions.status.loading")}
        </p>
      </div>
    );
  }

  const Icon = petition.reportType === "bug" ? Bug : Sparkles;
  const iconColor =
    petition.reportType === "bug" ? "text-red-500" : "text-emerald-500";
  const linked = petition.linkedQuests ?? [];

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4"
      data-testid="petition-status-page"
    >
      <Card className="shadow">
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Icon className={`size-6 shrink-0 ${iconColor} mt-1`} />
            <div className="flex-1">
              <h1 className="text-xl font-semibold">{petition.title}</h1>
              <p className="text-muted-foreground text-xs">
                {tr("petitions.status.submittedAt", {
                  args: [dt.of(petition.createdAt).fromNow()],
                })}
              </p>
            </div>
            <Badge
              variant={PETITION_STATUS_VARIANT[petition.status] ?? "secondary"}
              className="uppercase"
              data-testid="petition-status-badge"
            >
              {petition.status}
            </Badge>
          </div>

          <section>
            <h2 className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
              {tr("petitions.description")}
            </h2>
            <p className="whitespace-pre-wrap text-sm">
              {petition.description}
            </p>
          </section>

          {petition.attachmentUrls && petition.attachmentUrls.length > 0 && (
            <section>
              <h2 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                {tr("petitions.attachments")}
              </h2>
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
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {petition.status === "pending" && (
            <p
              className="text-muted-foreground text-sm"
              data-testid="petition-status-pending"
            >
              {tr("petitions.status.pending")}
            </p>
          )}

          {petition.status === "rejected" && (
            <p
              className="text-muted-foreground text-sm"
              data-testid="petition-status-rejected"
            >
              {tr("petitions.status.rejected")}
            </p>
          )}

          {petition.status === "accepted" && (
            <section data-testid="petition-status-linked-quests">
              <h2 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                {tr("petitions.status.progress")}
              </h2>
              {linked.length === 0 ? (
                <p
                  className="text-muted-foreground text-sm"
                  data-testid="petition-status-no-quests"
                >
                  {tr("petitions.status.acceptedNoQuests")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {linked.map((q) => (
                    <li
                      key={q.id}
                      data-testid={`petition-quest-${q.id}`}
                      data-quest-status={q.status}
                      className="bg-muted/30 flex items-center gap-2 rounded border border-border px-3 py-2 text-sm"
                    >
                      <ExternalLink className="size-3.5 shrink-0 opacity-50" />
                      <span className="flex-1 truncate">{q.title}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                          QUEST_STATUS_COLOR[q.status] ?? ""
                        }`}
                      >
                        {q.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </CardContent>
      </Card>

      <button
        type="button"
        onClick={() =>
          router.push("campaignPetitionRequest", {
            params: { campaignId: campaignIdParam },
          })
        }
        className="text-muted-foreground hover:text-foreground self-start text-sm"
      >
        {tr("petitions.status.submitAnother")}
      </button>
    </div>
  );
};

export default CampaignPetitionStatus;
