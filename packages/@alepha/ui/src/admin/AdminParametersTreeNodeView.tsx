import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import { ChevronRight, FileCog, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import { cn } from "../core/utils.ts";
import { type ParamNode, parameterLabel } from "./adminParametersTree.ts";

export interface AdminParametersTreeNodeViewProps {
  node: ParamNode;
  depth: number;
  selected: string | undefined;
  onSelect: (name: string) => void;
  onDeleteOrphan: (name: string) => void | Promise<void>;
}

export const AdminParametersTreeNodeView = (
  props: AdminParametersTreeNodeViewProps,
) => {
  const { node } = props;
  const { tr } = useI18n();
  const [open, setOpen] = useState(true);
  const isActive = node.isLeaf && props.selected === node.path;
  const label = parameterLabel(tr, node.path);
  const indent = props.depth * 12;
  const orphan = node.origin === "orphan";

  if (node.isLeaf) {
    return (
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => props.onSelect(node.path)}
          style={{ paddingLeft: 8 + indent }}
          className={cn(
            "hover:bg-hover flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
            isActive && "bg-accent text-accent-foreground font-medium",
            orphan && "text-muted-foreground",
          )}
        >
          <FileCog className="size-3.5 shrink-0 opacity-60" />
          <span className="truncate">{label}</span>
          {orphan && (
            // Saved rows with no `$parameter` behind them: editing changes
            // nothing this process reads. Shown only once orphans are
            // revealed, so the badge never has to explain itself twice.
            <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">
              {tr("admin.parameters.orphan", { default: "orphan" })}
            </Badge>
          )}
        </button>
        {orphan && (
          <Button
            type="button"
            variant="minimal"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive shrink-0"
            aria-label={tr("admin.parameters.orphanDeleteAction", {
              default: `Delete ${node.path}`,
              args: [node.path],
            })}
            onClick={() => props.onDeleteOrphan(node.path)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: 4 + indent }}
        className="hover:bg-hover text-muted-foreground flex items-center gap-1 rounded-md py-1.5 pr-2 text-left text-xs font-medium transition-colors"
      >
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        <span className="truncate">{label}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <AdminParametersTreeNodeView
            key={child.path}
            node={child}
            depth={props.depth + 1}
            selected={props.selected}
            onSelect={props.onSelect}
            onDeleteOrphan={props.onDeleteOrphan}
          />
        ))}
    </>
  );
};
