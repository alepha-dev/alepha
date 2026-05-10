import { Segmented } from "@alepha/ui/components/ui/segmented";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Inbox, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { BeaconController } from "@/api/controllers/BeaconController.ts";
import type { BeaconResource } from "@/api/schemas/beaconResourceSchema.ts";
import { currentBeaconCountAtom } from "../../../atoms/currentBeaconCountAtom.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import CampaignBeaconCard from "./CampaignBeaconCard.tsx";
import CampaignBeaconDrawer from "./CampaignBeaconDrawer.tsx";

type StatusFilter = "new" | "promoted" | "discarded" | "all";

export interface CampaignBeaconsProps {
  items: BeaconResource[];
}

const CampaignBeacons = (props: CampaignBeaconsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const [, setBeaconCount] = useStore(currentBeaconCountAtom);
  const beaconApi = useClient<BeaconController>();

  const [status, setStatus] = useState<StatusFilter>("new");
  const [items, setItems] = useState<BeaconResource[]>(props.items ?? []);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<BeaconResource | null>(null);

  const reload = async (next: StatusFilter = status) => {
    if (!campaign) return;
    setLoading(true);
    try {
      const res = await beaconApi.list({
        params: { campaignId: campaign.id },
        query: { status: next },
      });
      setItems(res.items);
      if (next === "new") {
        setBeaconCount({ count: res.items.length });
      } else {
        // Refresh new-count out-of-band so the tab badge stays accurate
        // even while the user is browsing promoted/discarded.
        beaconApi
          .list({
            params: { campaignId: campaign.id },
            query: { status: "new" },
          })
          .then((r) => setBeaconCount({ count: r.items.length }))
          .catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Skip the first render when the loader already populated `items`.
    if (status === "new" && props.items && items === props.items) {
      setBeaconCount({ count: props.items.length });
      return;
    }
    reload(status);
  }, [status]);

  const onChanged = () => {
    reload(status);
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">{tr("beacons.title")}</h2>
          {loading && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
        </div>
        <Segmented
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          options={[
            { value: "new", label: String(tr("beacons.filter.new")) },
            { value: "promoted", label: String(tr("beacons.filter.promoted")) },
            {
              value: "discarded",
              label: String(tr("beacons.filter.discarded")),
            },
            { value: "all", label: String(tr("beacons.filter.all")) },
          ]}
          size="sm"
        />
      </div>

      {items.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
          <Inbox className="size-10 opacity-60" />
          <p className="text-sm">
            {status === "new"
              ? tr("beacons.empty.new")
              : tr("beacons.empty.status", {
                  args: [String(tr(`beacons.filter.${status}` as const))],
                })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((beacon) => (
            <CampaignBeaconCard
              key={beacon.id}
              beacon={beacon}
              onClick={() => setActive(beacon)}
            />
          ))}
        </div>
      )}

      <CampaignBeaconDrawer
        beacon={active}
        onClose={() => setActive(null)}
        onChanged={() => {
          setActive(null);
          onChanged();
        }}
      />
    </div>
  );
};

export default CampaignBeacons;
