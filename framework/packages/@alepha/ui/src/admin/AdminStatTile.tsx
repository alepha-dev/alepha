import { useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Info } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "../core/Card.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../core/Tooltip.tsx";
import { cn } from "../core/utils.ts";
import { AdminStatTileDeltaChip } from "./AdminStatTileDeltaChip.tsx";

export interface AdminStatTileProps {
  /**
   * The dashboard card's id. The tile's query is keyed on it, not on `href`:
   * two tiles that open the same list are still two numbers.
   */
  id: string;

  /**
   * Heading, already localised by the caller.
   */
  label: ReactNode;

  icon?: ReactNode;

  /**
   * What exactly is counted, behind an info mark beside the label. Also read
   * out with the link, since a pointer-only tooltip is no explanation for a
   * keyboard or screen-reader user.
   */
  tooltip?: ReactNode;

  /**
   * A muted line under the number ("Signed in or refreshed in the last 24
   * hours."). A function receives what `load` resolved, for a note that
   * carries a figure of its own ("12 sign-ups in 7 days").
   */
  note?: ReactNode | ((loaded: AdminStatTileLoaded) => ReactNode);

  /**
   * Where the whole tile links: a path, query included. It should open the
   * list filtered to the same number the tile shows.
   */
  href: string;

  /**
   * Resolves the number, and optionally what its chip compares. A rejection
   * renders a localised "n/a" with the error behind it, never a toast: a
   * dashboard is glanceable, and one unreachable count is not an event.
   */
  load: () => Promise<AdminStatTileResult>;

  /**
   * Turns the tile warning-coloured when it holds. A threshold, never
   * "above 0": a tile that is always amber is a tile nobody reads.
   */
  alert?: (value: number) => boolean;

  /**
   * The chip's tooltip when `load` returns `previous`: what the value is
   * compared with. Defaults to "vs the previous period".
   */
  previousLabel?: ReactNode;
}

/**
 * The other number a tile's chip compares, when it is not the value shown:
 * the Users tile shows the total and compares sign-ups.
 */
export interface AdminStatTileDelta {
  current: number;
  previous: number;
  /**
   * What is compared, the chip's tooltip ("Sign-ups, last 7 days vs the 7
   * before").
   */
  label: ReactNode;
}

/**
 * What `load` resolves: the number alone, or the number with what its chip
 * compares. `previous` compares the value itself; `delta` compares another
 * number. Both at once is a type error: a chip says one thing.
 */
export type AdminStatTileResult =
  | number
  | { value: number; previous?: number; delta?: never }
  | { value: number; delta: AdminStatTileDelta; previous?: never };

/**
 * `load`'s result, normalised: what a `note` function receives.
 */
export interface AdminStatTileLoaded {
  value: number;
  previous?: number;
  delta?: AdminStatTileDelta;
}

/**
 * The admin dashboard's stat tile: icon and label, an info tooltip saying
 * what is counted, the number, a note, a delta chip, and a warning tone.
 *
 * ### The whole card is the link
 *
 * Not the title alone: the number is what an admin clicks. The tile is one
 * anchor holding the card, so it has one accessible name and one tab stop,
 * Control's border and its hover border, and a focus ring. The tooltip marks
 * inside it are spans, not buttons: an interactive element inside a link is
 * invalid markup, and the tooltip text is read out with the link anyway.
 */
export const AdminStatTile = (props: AdminStatTileProps) => {
  const { tr } = useI18n();
  const describedBy = useId();
  const query = useQuery(
    {
      // The card id identifies the number. `load` is a fresh closure on every
      // render of the parent, so it is not a dependency: the query reads the
      // latest one when it runs, and a re-render does not refetch.
      key: ["admin-dashboard-tile", props.id],
      handler: async (): Promise<AdminStatTileLoaded> => {
        const result = await props.load();
        return typeof result === "number" ? { value: result } : result;
      },
      // Quiet on purpose, as `load` says. `onError` marks the failure
      // handled, so a mounted `ActionErrorToaster` skips it.
      onError: () => {},
    },
    [props.id],
  );
  const loaded = query.data;
  const error = query.error;
  const alerting =
    loaded !== undefined && props.alert ? props.alert(loaded.value) : false;
  const note =
    typeof props.note === "function"
      ? loaded
        ? props.note(loaded)
        : null
      : props.note;
  const unavailable = tr("admin.dashboard.unavailable", { default: "n/a" });

  return (
    <TooltipProvider>
      <Link
        href={props.href}
        aria-describedby={props.tooltip ? describedBy : undefined}
        data-alert={alerting ? "" : undefined}
        className="group/tile focus-visible:ring-ring/50 block h-full rounded-xl outline-none focus-visible:ring-3"
      >
        <Card
          className={cn(
            "border-border group-hover/tile:border-border-hover h-full border ring-0 transition-colors",
            alerting && "border-warning/60 bg-warning/5",
          )}
        >
          <CardHeader className="pb-0">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              {props.icon}
              {props.label}
              {props.tooltip ? (
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="inline-flex cursor-help" />}
                  >
                    <Info className="size-3.5 opacity-70" aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {props.tooltip}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-baseline gap-2">
              <div
                data-slot="stat-value"
                className={cn(
                  "text-3xl font-bold tabular-nums",
                  alerting && "text-warning-text",
                )}
              >
                {error !== undefined ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className="cursor-help" />}>
                      {unavailable}
                    </TooltipTrigger>
                    <TooltipContent>
                      {error instanceof Error ? error.message : unavailable}
                    </TooltipContent>
                  </Tooltip>
                ) : loaded === undefined ? (
                  "…"
                ) : (
                  loaded.value.toLocaleString()
                )}
              </div>
              {loaded?.delta ? (
                <AdminStatTileDeltaChip
                  current={loaded.delta.current}
                  previous={loaded.delta.previous}
                  label={loaded.delta.label}
                />
              ) : loaded?.previous !== undefined ? (
                <AdminStatTileDeltaChip
                  current={loaded.value}
                  previous={loaded.previous}
                  label={
                    props.previousLabel ??
                    tr("admin.dashboard.vsPrevious", {
                      default: "vs the previous period",
                    })
                  }
                />
              ) : null}
            </div>
            {note ? (
              <p className="text-muted-foreground mt-1 text-xs">{note}</p>
            ) : null}
            {props.tooltip ? (
              <span id={describedBy} className="sr-only">
                {props.tooltip}
              </span>
            ) : null}
          </CardContent>
        </Card>
      </Link>
    </TooltipProvider>
  );
};
