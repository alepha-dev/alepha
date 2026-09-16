import * as React from "react";

void React;

import type { AdminParameterController } from "alepha/api/parameters";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { History as HistoryIcon, PanelRightClose } from "lucide-react";

import { Skeleton } from "../core/Skeleton.tsx";
import { cn } from "../core/utils.ts";
import { ParameterHistoryItem } from "./ParameterHistoryItem.tsx";

// ── Pane C: history ──────────────────────────────────────────────────

export interface AdminParametersHistoryPaneProps {
  name: string | undefined;
  reloadKey: number;
  onRollback: (version: number) => Promise<void>;
  onCollapse: () => void;
  className?: string;
}

export const AdminParametersHistoryPane = (
  props: AdminParametersHistoryPaneProps,
) => {
  const client = useClient<AdminParameterController>();
  const { tr } = useI18n();

  const { data: history } = useQuery(
    {
      handler: () =>
        client.getHistory({
          params: { name: props.name! },
          query: { limit: 50 },
        }),
      enabled: !!props.name,
    },
    [client, props.name, props.reloadKey],
  );

  return (
    <div
      className={cn(
        "bg-card flex min-h-0 flex-col overflow-hidden rounded-r-lg border",
        props.className,
      )}
    >
      <div className="text-muted-foreground flex items-center gap-1.5 px-3 py-2 text-xs font-medium tracking-wide uppercase">
        <HistoryIcon className="size-3.5" />
        {tr("admin.parameters.historyTitle", { default: "History" })}
        {/* Closing the pane from inside it, the way Lore's folio inspector
            does. Offered only where the pane is a column: stacked under the
            form, closing it would free no width. */}
        <button
          type="button"
          onClick={props.onCollapse}
          aria-label={tr("admin.parameters.historyCollapse", {
            default: "Hide history",
          })}
          title={tr("admin.parameters.historyCollapse", {
            default: "Hide history",
          })}
          className="text-muted-foreground hover:text-foreground hover:bg-accent ml-auto hidden size-6.5 items-center justify-center rounded-md transition-colors lg:flex"
        >
          <PanelRightClose className="size-3.5" />
        </button>
      </div>
      {!props.name ? (
        <span className="text-muted-foreground px-3 py-2 text-xs">
          {tr("admin.parameters.historyHint", {
            default: "Select a parameter to see its versions.",
          })}
        </span>
      ) : !history ? (
        <div className="flex flex-col border-t">
          {["s1", "s2", "s3"].map((k) => (
            <div
              key={k}
              className="flex items-center gap-3 border-b px-3 py-2.5"
            >
              <Skeleton className="size-4 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      ) : !history.versions.length ? (
        <span className="text-muted-foreground px-3 py-2 text-xs">
          {tr("admin.parameters.historyEmpty", {
            default: "No saved versions yet",
          })}
        </span>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t">
          {[...history.versions]
            // Most recent activation on top.
            .sort(
              (a, b) =>
                b.activationDate.localeCompare(a.activationDate) ||
                b.version - a.version,
            )
            .map((v) => (
              <ParameterHistoryItem
                key={v.id}
                version={v}
                onRollback={props.onRollback}
              />
            ))}
        </div>
      )}
    </div>
  );
};
