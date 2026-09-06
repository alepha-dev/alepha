import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { GripVertical } from "lucide-react";
import type { DragEvent } from "react";

import type { DashboardCardResource } from "@/api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue as CardValue } from "@/api/schemas/dashboardCardValueSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import DashboardCardFooter from "./DashboardCardFooter.tsx";
import DashboardCardMenu from "./DashboardCardMenu.tsx";
import DashboardCardValue from "./DashboardCardValue.tsx";
import { dashboardFilterChipKeys } from "./dashboardChips.ts";
import { dashboardMetricIcon } from "./dashboardMetricIcon.ts";

export interface DashboardCardProps {
  card: DashboardCardResource;
  /**
   * Absent until the first resolve returns.
   */
  value?: CardValue;
  /**
   * i18n key for the metric's title, from the catalogue.
   */
  labelKey: string;
  /**
   * lucide id for the metric's icon, from the catalogue.
   */
  icon: string;
  /**
   * Whether a mousedown on this card's header has armed it for dragging.
   *
   * `draggable` is toggled rather than left on: a permanently draggable card
   * cannot be clicked, because the browser starts a drag on the first pixel
   * of movement and the click never lands.
   */
  armed: boolean;
  dragging: boolean;
  over: boolean;
  onArm: () => void;
  onDisarm: () => void;
  onDragStart: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: () => void;
  onChangeScope: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/**
 * One tile.
 *
 * ## Drag comes from the header, not the whole card
 *
 * `draggable` is armed on mousedown over the header strip and disarmed on
 * mouseup, exactly as the mockup does it. Without that, a card whose body is
 * a link cannot be clicked: the browser starts a drag on the first pixel of
 * movement and the click never lands.
 *
 * Native HTML5 drag rather than `@dnd-kit`, which the kanban board uses. The
 * board needs cross-column transfer, drop-zone hit-testing and a lifecycle
 * gate; this is a flat list reordering itself, `@dnd-kit/sortable` is not a
 * dependency of this app, and the mockup was drawn with the native events.
 *
 * ## The whole tile is the drill-through
 *
 * A card with a `link` is a button over its own body. Cards without one (a
 * failed resolve, or a visitors card with no beacon app) are inert rather
 * than clickable-but-dead, because a link to a 404 is worse than no link.
 */
const DashboardCard = (props: DashboardCardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const Icon = dashboardMetricIcon(props.icon);
  const link = props.value?.link;

  const scopeChip = (() => {
    if (props.card.scope.kind === "all") return tr("dashboard.scope.all");
    const names = props.value?.scopeNames ?? [];
    if (names.length === 1) return names[0];
    if (names.length === 0) return undefined;
    return tr(
      props.card.scope.kind === "apps"
        ? "dashboard.scope.apps"
        : "dashboard.scope.projects",
      { args: [String(names.length)] },
    );
  })();

  const open = () => {
    if (!link) return;
    void router.push(
      link.route as never,
      {
        params: link.params,
        query: link.query,
      } as never,
    );
  };

  return (
    <div
      data-testid="dashboard-card"
      data-metric={props.card.metric}
      draggable={props.armed || undefined}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      style={{ gridColumn: `span ${props.card.size}` }}
      className={cn(
        "bg-card relative flex h-full flex-col gap-2.5 rounded-xl p-3.5 shadow-[inset_0_0_0_1px_var(--border)]",
        props.dragging && "opacity-45",
        props.over && "shadow-[inset_0_0_0_2px_var(--primary)]",
      )}
    >
      {/* A drag affordance, pointer-only by nature; the card it belongs to is reachable and actionable by keyboard on its own. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="flex cursor-grab items-center gap-2 active:cursor-grabbing"
        onMouseDown={props.onArm}
        onMouseUp={props.onDisarm}
        title={tr("dashboard.card.drag")}
      >
        <Icon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-muted-foreground truncate text-[11.5px] font-medium tracking-[0.05em] uppercase">
          {tr(props.labelKey as never)}
        </span>
        <span className="flex-1" />
        <GripVertical className="text-muted-foreground/45 size-[13px] shrink-0" />
        <DashboardCardMenu
          onChangeScope={props.onChangeScope}
          onDuplicate={props.onDuplicate}
          onRemove={props.onRemove}
        />
      </div>
      <div className="flex flex-wrap gap-[5px]">
        {scopeChip && (
          <span className="bg-muted inline-flex h-[19px] items-center rounded-full px-[7px] text-[11px]">
            {scopeChip}
          </span>
        )}
        {dashboardFilterChipKeys(props.card).map((key) => (
          <span
            key={key}
            className="bg-muted inline-flex h-[19px] items-center rounded-full px-[7px] text-[11px]"
          >
            {tr(key as never)}
          </span>
        ))}
      </div>
      {link ? (
        <button
          type="button"
          onClick={open}
          data-testid="dashboard-card-open"
          className="flex flex-1 flex-col items-start justify-start gap-1 text-left"
        >
          <DashboardCardValue value={props.value} />
          <DashboardCardFooter metric={props.card.metric} value={props.value} />
        </button>
      ) : (
        <div className="flex flex-1 flex-col items-start justify-start gap-1">
          <DashboardCardValue value={props.value} />
          <DashboardCardFooter metric={props.card.metric} value={props.value} />
        </div>
      )}
    </div>
  );
};

export default DashboardCard;
