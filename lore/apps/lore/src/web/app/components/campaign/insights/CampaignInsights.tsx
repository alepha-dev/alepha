import { Segmented } from "@alepha/ui/components/ui/segmented";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type {
  InsightsController,
  InsightsResource,
} from "@/api/controllers/InsightsController.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import CampaignInsightsAnalytics from "./CampaignInsightsAnalytics.tsx";
import CampaignInsightsPerformance from "./CampaignInsightsPerformance.tsx";

export interface CampaignInsightsProps {
  insights: InsightsResource;
}

type Range = "1d" | "7d" | "30d";
const RANGES: Range[] = ["1d", "7d", "30d"];

type View = "analytics" | "performance";

const CampaignInsights = (props: CampaignInsightsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const insightsApi = useClient<InsightsController>();
  const toaster = useToast();

  const [data, setData] = useState<InsightsResource>(props.insights);
  const [range, setRange] = useState<Range>(props.insights.range ?? "7d");
  const [view, setView] = useState<View>("analytics");
  const [loading, setLoading] = useState(false);

  const changeRange = async (next: Range) => {
    if (!campaign || next === range) return;
    const previous = range;
    setRange(next);
    setLoading(true);
    try {
      const res = await insightsApi.getInsights({
        params: { campaignId: campaign.id },
        query: { range: next },
      });
      setData(res);
    } catch (error: any) {
      // A failed range fetch leaves stale data — surface it via a toast and
      // roll the range toggle back so it matches the data actually shown.
      setRange(previous);
      toaster.show(error?.message || tr("insights.error"), "danger");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Analytics / Performance switch + range toggle */}
      <div className="flex items-center justify-between gap-3">
        <Segmented
          size="sm"
          value={view}
          onChange={(next) => setView(next as View)}
          options={[
            { value: "analytics", label: tr("insights.tab.analytics") },
            { value: "performance", label: tr("insights.tab.performance") },
          ]}
        />
        <div className="flex items-center gap-2">
          {loading && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
          <div className="bg-muted flex gap-0.5 rounded-md p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => void changeRange(r)}
                className={
                  r === range
                    ? "bg-background rounded px-3 py-1 text-xs font-medium shadow-sm"
                    : "text-muted-foreground rounded px-3 py-1 text-xs"
                }
              >
                {tr(`insights.range.${r}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "analytics" ? (
        <CampaignInsightsAnalytics data={data} />
      ) : (
        <CampaignInsightsPerformance data={data} />
      )}
    </div>
  );
};

export default CampaignInsights;
