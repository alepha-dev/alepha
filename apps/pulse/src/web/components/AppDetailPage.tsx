import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { useRouter } from "alepha/react/router";
import { ArrowLeft } from "lucide-react";
import AnalyticsView from "./AnalyticsView.tsx";
import ErrorsView from "./ErrorsView.tsx";
import VitalsCards from "./VitalsCards.tsx";

export interface AppDetailPageProps {
  slug: string;
  view: string;
  days: number;
  overview: {
    name: string;
    status: string;
    release?: string;
    errors24h: number;
  };
  analytics: {
    views: number;
    uniques: number;
    timeline: Array<{ day: string; count: number }>;
    topPaths: Array<{ path: string; count: number }>;
    topCountries: Array<{ country: string; count: number }>;
    vitals: Record<string, number>;
  };
  errors: ErrorRow[];
}

/**
 * One app's insights — the page Lore used to have, for an app hosted anywhere.
 *
 * Three views rather than a single scroll: traffic, speed and failures are
 * looked at for different reasons, and stacking them means scrolling past two
 * to reach the one that matters.
 */
const AppDetailPage = (props: AppDetailPageProps) => {
  const router = useRouter();

  const go = (patch: { view?: string; days?: number }) =>
    void router.push("app", {
      params: { slug: props.slug },
      query: {
        view: patch.view ?? props.view,
        days: String(patch.days ?? props.days),
      },
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void router.push("home")}
          aria-label="Back to apps"
        >
          <ArrowLeft />
        </Button>
        <h1 className="text-2xl font-semibold">{props.overview.name}</h1>
        <Badge
          variant={props.overview.status === "up" ? "secondary" : "outline"}
        >
          {props.overview.status}
        </Badge>
        {props.overview.errors24h > 0 && (
          <Badge variant="destructive">
            {props.overview.errors24h} errors / 24h
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="sm"
          value={props.view}
          onChange={(next) => go({ view: next as string })}
          options={[
            { value: "analytics", label: "Analytics" },
            { value: "performance", label: "Performance" },
            { value: "errors", label: "Errors" },
          ]}
        />
        {props.view !== "errors" && (
          <div className="flex gap-2">
            {[1, 7, 30].map((days) => (
              <Button
                key={days}
                size="sm"
                variant={props.days === days ? "default" : "outline"}
                onClick={() => go({ days })}
              >
                {days}d
              </Button>
            ))}
          </div>
        )}
      </div>

      {props.view === "analytics" && <AnalyticsView {...props.analytics} />}
      {props.view === "performance" && (
        <VitalsCards vitals={props.analytics.vitals} />
      )}
      {props.view === "errors" && <ErrorsView errors={props.errors} />}
    </div>
  );
};

interface ErrorRow {
  fingerprint: string;
  name: string;
  message: string;
  sourceUrl: string;
  origin: string;
  release?: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export default AppDetailPage;
