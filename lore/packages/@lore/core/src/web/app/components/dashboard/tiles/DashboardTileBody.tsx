import { Skeleton } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import {
  Activity,
  BookOpen,
  CalendarCheck,
  Coffee,
  Flag,
  Layers,
  ListChecks,
  Lock,
  Radio,
  Rows3,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { DashboardCardResource } from "../../../../../api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue as CardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import type { DashboardPresentation } from "../../../../../api/schemas/DashboardMetricCatalog.ts";
import type { I18n } from "../../../services/I18n.ts";
import DashboardCardFooter from "../DashboardCardFooter.tsx";
import DashboardCardValue from "../DashboardCardValue.tsx";
import DashboardSegmentBar from "./DashboardSegmentBar.tsx";
import DashboardSparkline from "./DashboardSparkline.tsx";
import DashboardTileChart from "./DashboardTileChart.tsx";
import DashboardTileNote from "./DashboardTileNote.tsx";
import DashboardTileRow from "./DashboardTileRow.tsx";
import DashboardTileStatus from "./DashboardTileStatus.tsx";
import DashboardTileTable from "./DashboardTileTable.tsx";

export interface DashboardTileBodyProps {
  card: DashboardCardResource;
  /**
   * Absent until the first resolve returns.
   */
  value?: CardValue;
  presentation?: DashboardPresentation;
  chartStyle?: "area" | "bars";
}

/**
 * Everything under a tile's header, drawn by the renderer its PRESENTATION
 * picks (#E77, #Q2648). Never by metric key: a new metric is one catalogue
 * entry plus one resolver, and it inherits its drawing from here.
 *
 * Four states come before any renderer, the same for all of them:
 *
 * - not resolved yet: a skeleton, so nothing jumps;
 * - failed (`ok: false`): a short line saying so, never a zero;
 * - empty (`empty`): a gentle, centred line with an icon for the reason
 *   (#Q4402). Every reader sees it: a tile is never hidden for having
 *   nothing to show, `noAccess` aside, which only a curator sees;
 * - resolved: the renderer.
 *
 * A `note` needs no resolve: its body is the card's own filters.
 */
const DashboardTileBody = (props: DashboardTileBodyProps) => {
  const { tr } = useI18n<I18n, "en">();
  const value = props.value;
  // A value may draw differently from its metric (#Q3520).
  const presentation =
    (value?.ok && !value.empty ? value.presentation : undefined) ??
    props.presentation;

  // A note is the card's own markdown (the owner's, #Q2659) or, for a
  // resolved note such as the pinned folio (#Q2658), what the resolver put
  // in `detail.markdown`. Only the second waits for a resolve.
  if (presentation === "note") {
    const own = props.card.filters.markdown;
    if (typeof own === "string" && own.length > 0) {
      return <DashboardTileNote markdown={own} />;
    }
    const resolved =
      value?.ok && !value.empty ? value.detail.markdown : undefined;
    if (typeof resolved === "string") {
      return (
        <DashboardTileNote
          markdown={resolved}
          more={value?.detail.more === true ? value.link : undefined}
        />
      );
    }
  }

  if (!value) {
    return (
      <div className="flex flex-col gap-2" data-testid="tile-loading">
        <Skeleton className="mt-0.5 h-8 w-20" />
        <Skeleton className="h-3.5 w-32" />
      </div>
    );
  }

  if (!value.ok) {
    return (
      <div className="flex flex-col gap-1" data-testid="tile-failed">
        <div className="text-muted-foreground mt-0.5 text-sm">
          {tr("dashboard.card.failed")}
        </div>
        <div className="text-muted-foreground text-xs">
          {tr("dashboard.card.failed.hint")}
        </div>
      </div>
    );
  }

  if (value.empty) {
    const Icon = EMPTY_ICONS[value.empty] ?? Sparkles;
    return (
      <div
        className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1.5 self-stretch py-2 text-center text-[12.5px]"
        data-testid="tile-empty"
        data-reason={value.empty}
      >
        <Icon className="text-muted-foreground/60 size-5" aria-hidden />
        <span>{tr(`dashboard.empty.${value.empty}`)}</span>
      </div>
    );
  }

  const footer = (
    <DashboardCardFooter metric={props.card.metric} value={value} />
  );

  switch (presentation) {
    case "trend":
      return (
        <>
          <DashboardCardValue value={value} presentation="trend" />
          {value.series && value.series.length > 0 && (
            <DashboardSparkline series={value.series} height={36} />
          )}
          {footer}
        </>
      );
    case "progress":
      return (
        <>
          <DashboardCardValue value={value} presentation="progress" />
          {value.segments && value.segments.length > 0 && (
            <DashboardSegmentBar
              segments={value.segments}
              legend={value.value === undefined}
            />
          )}
          {footer}
        </>
      );
    case "chart":
      return (
        <>
          <DashboardTileChart value={value} chartStyle={props.chartStyle} />
          {footer}
        </>
      );
    case "status":
      return (
        <>
          <DashboardTileStatus rows={value.rows ?? []} />
          {footer}
        </>
      );
    case "table":
      return (
        <>
          <DashboardTileTable value={value} />
          {footer}
        </>
      );
    case "list":
    case "feed":
      return (
        <>
          <ul className="flex w-full min-w-0 flex-col" data-testid="tile-rows">
            {(value.rows ?? []).map((row, index) => (
              <DashboardTileRow
                key={row.id ?? `${row.title}-${index}`}
                row={row}
                variant={presentation === "feed" ? "feed" : "list"}
              />
            ))}
          </ul>
          {footer}
        </>
      );
    default:
      return (
        <>
          <DashboardCardValue value={value} presentation={presentation} />
          {footer}
        </>
      );
  }
};

export default DashboardTileBody;

/**
 * The icon an empty tile draws beside its line, per reason: something
 * calm, never a warning, since nothing is wrong (#Q4402).
 */
const EMPTY_ICONS: Partial<Record<string, LucideIcon>> = {
  noData: Sparkles,
  noEpic: Layers,
  noRelease: Flag,
  noSigil: Radio,
  noBeacon: Radio,
  silent: Radio,
  noRows: Rows3,
  nothingAhead: CalendarCheck,
  noFolio: BookOpen,
  noActivity: Activity,
  noQuests: ListChecks,
  noJobs: Coffee,
  noAccess: Lock,
};
