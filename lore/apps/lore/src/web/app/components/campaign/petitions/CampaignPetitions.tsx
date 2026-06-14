import { Segmented } from "@alepha/ui/components/ui/segmented";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { PetitionResource } from "@/api/schemas/petitionResourceSchema.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import { currentPetitionCountAtom } from "../../../atoms/currentPetitionCountAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import CampaignPetitionCard from "./CampaignPetitionCard.tsx";
import CampaignPetitionDetail from "./CampaignPetitionDetail.tsx";

type StatusFilter = "pending" | "accepted" | "rejected" | "all";

export interface CampaignPetitionsProps {
  items: PetitionResource[];
}

const CampaignPetitions = (props: CampaignPetitionsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const [, setPetitionCount] = useStore(currentPetitionCountAtom);
  const petitionApi = useClient<PetitionController>();

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<PetitionResource[]>(props.items ?? []);
  const [activeId, setActiveId] = useState<number | null>(
    props.items?.[0]?.id ?? null,
  );

  // No loading indicator on purpose: the status switch refetches in ~300ms and
  // a spinner next to the segmented control reads as flicker (petition #11).
  const reload = async (next: StatusFilter = status) => {
    if (!campaign) return;
    const res = await petitionApi.listPetitions({
      params: { campaignId: campaign.id },
      query: { status: next },
    });
    setItems(res.items);
    setActiveId(res.items[0]?.id ?? null);
    if (next === "pending") {
      setPetitionCount({ count: res.items.length });
    } else {
      petitionApi
        .listPetitions({
          params: { campaignId: campaign.id },
          query: { status: "pending" },
        })
        .then((r) => setPetitionCount({ count: r.items.length }))
        .catch(() => {});
    }
  };

  useEffect(() => {
    if (status === "pending" && props.items && items === props.items) {
      setPetitionCount({ count: props.items.length });
      return;
    }
    reload(status);
  }, [status]);

  const active = items.find((p) => p.id === activeId) ?? null;

  const onChanged = () => {
    reload(status);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* List + detail split */}
      <div className="flex min-h-0 flex-1">
        {/* Left list */}
        <aside
          className={cn(
            "flex w-full flex-col border-r md:w-[300px] md:shrink-0",
            active && "hidden md:flex",
          )}
        >
          <div className="border-border flex items-center gap-2 border-b p-2">
            <Segmented
              value={status}
              onChange={(v) => setStatus(v as StatusFilter)}
              options={[
                {
                  value: "pending",
                  label: tr("petitions.filter.pending"),
                },
                {
                  value: "accepted",
                  label: tr("petitions.filter.accepted"),
                },
                {
                  value: "rejected",
                  label: tr("petitions.filter.rejected"),
                },
                { value: "all", label: tr("petitions.filter.all") },
              ]}
              size="sm"
              fullWidth
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
                <Inbox className="size-8 opacity-60" />
                <p className="text-sm">
                  {status === "pending"
                    ? tr("petitions.empty.pending")
                    : tr("petitions.empty.status", {
                        args: [tr(`petitions.filter.${status}` as const)],
                      })}
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {items.map((petition) => (
                  <CampaignPetitionCard
                    key={petition.id}
                    petition={petition}
                    selected={petition.id === activeId}
                    onClick={() => setActiveId(petition.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Right detail */}
        <section className={cn("min-w-0 flex-1", !active && "hidden md:block")}>
          {active ? (
            <CampaignPetitionDetail
              petition={active}
              onChanged={onChanged}
              onBack={() => setActiveId(null)}
            />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <Inbox className="size-10 opacity-50" />
              <p className="text-sm">{tr("petitions.empty.selectOne")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default CampaignPetitions;
