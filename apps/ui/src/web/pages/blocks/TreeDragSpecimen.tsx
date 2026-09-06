import {
  buildTree,
  findNode,
  flattenTree,
  resolveDrop,
} from "@alepha/ui/components/tree-view/tree-model.ts";
import { TreeView } from "@alepha/ui/components/tree-view/tree-view";
import { useTreeState } from "@alepha/ui/components/tree-view/use-tree-state.ts";
import { FileText, Folder, FolderOpen } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import {
  buildTreeItems,
  reparent,
  type TreeSpecimenData,
  type TreeSpecimenItem,
} from "@/web/pages/blocks/treeFixture.ts";

export interface TreeDragSpecimenProps {
  depth: number;
}

/**
 * Tier two: the drag gesture.
 *
 * The 28/44/28 zones on a branch, 50/50 on a leaf, the markers, and the guard
 * that refuses a branch dropped into its own subtree.
 *
 * ⚠️ The "resolved parent" line beside the tree is not decoration. A drop that
 * is refused and a drop that lands somewhere unexpected look identical while
 * the pointer is moving, and this is the only thing on the page that says
 * which happened: it changes on a legal move and does NOT change on a refused
 * one. `apps/ui/e2e/tree.spec.ts` reads its three cases off it.
 */
export const TreeDragSpecimen = (
  props: TreeDragSpecimenProps,
): ReactElement => {
  const [items, setItems] = useState<TreeSpecimenItem[]>(() =>
    buildTreeItems(props.depth),
  );
  const [lastMove, setLastMove] = useState("nothing moved yet");

  // The depth knob rebuilds the fixture, which discards whatever the reader
  // dragged. That is the honest behaviour for a knob that changes the data.
  const [knobDepth, setKnobDepth] = useState(props.depth);
  if (knobDepth !== props.depth) {
    setKnobDepth(props.depth);
    setItems(buildTreeItems(props.depth));
    setLastMove("nothing moved yet");
  }

  const nodes = useMemo(() => buildTree<TreeSpecimenData>(items), [items]);

  const state = useTreeState({
    onRename: () => {},
    onMove: (dragId, targetId, position) => {
      const target = resolveDrop(nodes, dragId, targetId, position);
      // `undefined` covers both an illegal drop and a true no-op, and
      // neither is a write.
      if (!target) return;
      const dragged = findNode(nodes, dragId);
      const parent = target.parentId
        ? findNode(nodes, target.parentId)?.name
        : "the root";
      setItems(reparent(items, dragId, target.parentId));
      setLastMove(`${dragged?.name} is now in ${parent}`);
    },
  });

  return (
    <div className="flex flex-1 gap-4">
      <div className="w-64 flex-none">
        <TreeView<TreeSpecimenData>
          label="Files"
          rows={flattenTree(nodes, state.collapsed)}
          collapsed={state.collapsed}
          onSelect={() => {}}
          onToggle={state.commands.toggle}
          renderIcon={(node, rowState) => {
            if (!node.branch) {
              return (
                <FileText className="text-muted-foreground size-3.5 shrink-0" />
              );
            }
            const Icon = rowState.collapsed ? Folder : FolderOpen;
            return <Icon className="text-primary size-3.5 shrink-0" />;
          }}
          draggable
          dragId={state.dragId}
          drop={state.drop}
          onDragStart={state.commands.onDragStart}
          onDragOver={state.commands.onDragOver}
          onDrop={state.commands.onDrop}
          onDragEnd={state.commands.onDragEnd}
        />
      </div>
      <div className="text-muted-foreground flex-1 text-sm">
        <p data-testid="resolved-parent">
          Resolved parent: <span className="font-medium">{lastMove}</span>
        </p>
        <p className="mt-2 text-xs">
          A branch row splits 28% / 44% / 28% into before, inside and after. A
          leaf splits in half, because it cannot hold children. Drag a branch
          onto anything inside itself and nothing happens: the line above does
          not move.
        </p>
      </div>
    </div>
  );
};
