import {
  buildTree,
  flattenTree,
} from "@alepha/ui/components/tree-view/tree-model.ts";
import { TreeView } from "@alepha/ui/components/tree-view/tree-view";
import { FileText, Folder, FolderOpen } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import {
  buildTreeItems,
  type TreeSpecimenData,
} from "@/web/pages/blocks/treeFixture.ts";

export interface TreeNavSpecimenProps {
  depth: number;
}

/**
 * Tier one: read only.
 *
 * Rows, icons, selection and disclosure, from five props and no hook. This is
 * the shape a documentation sidebar or any plain navigation tree needs, and it
 * is here to prove the component is useful before any capability is turned on:
 * nothing below this line is paid for by a consumer that does not want it.
 */
export const TreeNavSpecimen = (props: TreeNavSpecimenProps): ReactElement => {
  const nodes = useMemo(
    () => buildTree<TreeSpecimenData>(buildTreeItems(props.depth)),
    [props.depth],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(["empty"]),
  );
  const [selectedId, setSelectedId] = useState<string>();

  return (
    <TreeView<TreeSpecimenData>
      label="Files"
      rows={flattenTree(nodes, collapsed)}
      collapsed={collapsed}
      selectedId={selectedId}
      onSelect={(node) => setSelectedId(node.id)}
      onToggle={(id) => {
        const next = new Set(collapsed);
        if (!next.delete(id)) next.add(id);
        setCollapsed(next);
      }}
      renderIcon={(node, state) => {
        if (!node.branch) {
          return (
            <FileText className="text-muted-foreground size-3.5 shrink-0" />
          );
        }
        const Icon = state.collapsed ? Folder : FolderOpen;
        return <Icon className="text-primary size-3.5 shrink-0" />;
      }}
    />
  );
};
