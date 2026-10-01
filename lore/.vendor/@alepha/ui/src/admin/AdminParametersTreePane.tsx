import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import { Eye, EyeOff, Settings2 } from "lucide-react";

import { Button } from "../core/Button.tsx";
import { Skeleton } from "../core/Skeleton.tsx";
import type { ParamNode } from "./adminParametersTree.ts";
import { AdminParametersTreeFooterActions } from "./AdminParametersTreeFooterActions.tsx";
import { AdminParametersTreeNodeView } from "./AdminParametersTreeNodeView.tsx";

// ── Pane A: tree ─────────────────────────────────────────────────────

export interface AdminParametersTreePaneProps {
  nodes: ParamNode[] | undefined;
  selected: string | undefined;
  onSelect: (name: string) => void;
  onExportAll: () => void | Promise<void>;
  onImport: (file: File) => void | Promise<void>;
  exporting?: boolean;
  importing?: boolean;
  /**
   * Orphan leaves in the whole tree, shown or not: the toggle names the
   * number so a hidden orphan is never a secret.
   */
  orphanCount: number;
  showOrphans: boolean;
  onToggleOrphans: () => void;
  onDeleteOrphan: (name: string) => void | Promise<void>;
}

export const AdminParametersTreePane = (
  props: AdminParametersTreePaneProps,
) => {
  const { tr } = useI18n();
  return (
    <div className="bg-card flex min-h-0 flex-col gap-2 rounded-l-lg border p-2">
      <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-xs font-medium tracking-wide uppercase">
        <Settings2 className="size-3.5" />
        {tr("admin.parameters.treeTitle", { default: "Parameters" })}
        {props.orphanCount > 0 && (
          <Button
            type="button"
            variant="minimal"
            size="sm"
            className="ml-auto h-6 gap-1 px-1.5 text-[11px] tracking-normal normal-case"
            aria-pressed={props.showOrphans}
            onClick={props.onToggleOrphans}
          >
            {props.showOrphans ? (
              <EyeOff className="size-3" />
            ) : (
              <Eye className="size-3" />
            )}
            {props.showOrphans
              ? tr("admin.parameters.orphansHide", {
                  default: `Hide ${props.orphanCount} orphan(s)`,
                  args: [String(props.orphanCount)],
                })
              : tr("admin.parameters.orphansShow", {
                  default: `Show ${props.orphanCount} orphan(s)`,
                  args: [String(props.orphanCount)],
                })}
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-2">
        {!props.nodes ? (
          // Loading — distinct from an empty (loaded) tree.
          ["t1", "t2", "t3", "t4", "t5"].map((k, i) => (
            <div key={k} className="flex items-center gap-1.5 px-2 py-1.5">
              <Skeleton className="size-3.5 shrink-0 rounded" />
              <Skeleton
                className="h-3.5"
                style={{ width: `${[70, 55, 80, 50, 65][i]}%` }}
              />
            </div>
          ))
        ) : props.nodes.length ? (
          props.nodes.map((node) => (
            <AdminParametersTreeNodeView
              key={node.path}
              node={node}
              depth={0}
              selected={props.selected}
              onSelect={props.onSelect}
              onDeleteOrphan={props.onDeleteOrphan}
            />
          ))
        ) : (
          <span className="text-muted-foreground px-2 py-1 text-xs">
            {tr("admin.parameters.treeEmpty", {
              default: "No parameters registered.",
            })}
          </span>
        )}
      </div>
      <AdminParametersTreeFooterActions
        onExportAll={props.onExportAll}
        onImport={props.onImport}
        exporting={props.exporting}
        importing={props.importing}
        disabled={!props.nodes?.length}
      />
    </div>
  );
};
