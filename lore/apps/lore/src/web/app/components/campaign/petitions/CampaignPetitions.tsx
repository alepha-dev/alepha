import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Inbox, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { PetitionController } from "@/api/controllers/PetitionController.ts";
import type { PetitionResource } from "@/api/schemas/petitionResourceSchema.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import { currentPetitionCountAtom } from "../../../atoms/currentPetitionCountAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import CampaignPetitionCard from "./CampaignPetitionCard.tsx";
import CampaignPetitionDrawer from "./CampaignPetitionDrawer.tsx";

type StatusFilter = "pending" | "accepted" | "rejected" | "all";

export interface CampaignPetitionsProps {
  items: PetitionResource[];
}

const CampaignPetitions = (props: CampaignPetitionsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const [, setPetitionCount] = useStore(currentPetitionCountAtom);
  const petitionApi = useClient<PetitionController>();

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<PetitionResource[]>(props.items ?? []);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<PetitionResource | null>(null);

  const reload = async (next: StatusFilter = status) => {
    if (!campaign) return;
    setLoading(true);
    try {
      const res = await petitionApi.listPetitions({
        params: { campaignId: campaign.id },
        query: { status: next },
      });
      setItems(res.items);
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === "pending" && props.items && items === props.items) {
      setPetitionCount({ count: props.items.length });
      return;
    }
    reload(status);
  }, [status]);

  const onChanged = () => {
    reload(status);
  };

  const openCreate = () => {
    if (!campaign) return;
    router.push("campaignPetitionRequest", {
      params: { campaignId: String(campaign.id) },
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">{tr("petitions.title")}</h2>
          {loading && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            options={[
              {
                value: "pending",
                label: String(tr("petitions.filter.pending")),
              },
              {
                value: "accepted",
                label: String(tr("petitions.filter.accepted")),
              },
              {
                value: "rejected",
                label: String(tr("petitions.filter.rejected")),
              },
              { value: "all", label: String(tr("petitions.filter.all")) },
            ]}
            size="sm"
          />
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            {tr("petitions.create")}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
          <Inbox className="size-10 opacity-60" />
          <p className="text-sm">
            {status === "pending"
              ? tr("petitions.empty.pending")
              : tr("petitions.empty.status", {
                  args: [String(tr(`petitions.filter.${status}` as const))],
                })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((petition) => (
            <CampaignPetitionCard
              key={petition.id}
              petition={petition}
              onClick={() => setActive(petition)}
            />
          ))}
        </div>
      )}

      <CampaignPetitionDrawer
        petition={active}
        onClose={() => setActive(null)}
        onChanged={() => {
          setActive(null);
          onChanged();
        }}
      />
    </div>
  );
};

export default CampaignPetitions;
