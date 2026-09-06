import {
  buildTree,
  findNode,
  flattenTree,
  resolveDrop,
} from "@alepha/ui/components/tree-view/tree-model.ts";
import { TreeView } from "@alepha/ui/components/tree-view/tree-view";
import { TreeViewResizer } from "@alepha/ui/components/tree-view/tree-view-resizer";
import { useTreeState } from "@alepha/ui/components/tree-view/use-tree-state.ts";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@alepha/ui/components/ui/context-menu";
import { FileText, Folder, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import {
  buildTreeItems,
  reparent,
  type TreeSpecimenData,
  type TreeSpecimenItem,
} from "@/web/pages/blocks/treeFixture.ts";

export interface TreeEditorSpecimenProps {
  depth: number;
  draggable: boolean;
  renamable: boolean;
  menu: boolean;
}

/**
 * Tier three: everything at once, and the tier the knobs drive.
 *
 * Inline rename, a context menu of the consumer's own verbs, the pane resizer
 * and a trailing badge. Lore's folio tree minus Lore.
 *
 * The menu carries a Rename item on purpose: `apps/ui/e2e/tree.spec.ts`'s
 * fourth case is right-click, Rename, Escape, which is the one guard jsdom
 * cannot reach (a portal it will not lay out, and a blur that fires during an
 * unmount).
 */
export const TreeEditorSpecimen = (
  props: TreeEditorSpecimenProps,
): ReactElement => {
  const [items, setItems] = useState<TreeSpecimenItem[]>(() =>
    buildTreeItems(props.depth),
  );
  const [width, setWidth] = useState(242);
  const [selectedId, setSelectedId] = useState<string>();

  const [knobDepth, setKnobDepth] = useState(props.depth);
  if (knobDepth !== props.depth) {
    setKnobDepth(props.depth);
    setItems(buildTreeItems(props.depth));
  }

  const nodes = useMemo(() => buildTree<TreeSpecimenData>(items), [items]);

  const state = useTreeState({
    onRename: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setItems(
        items.map((item) =>
          item.id === id ? { ...item, name: trimmed } : item,
        ),
      );
    },
    onMove: (dragId, targetId, position) => {
      const target = resolveDrop(nodes, dragId, targetId, position);
      if (!target) return;
      setItems(reparent(items, dragId, target.parentId));
    },
  });

  const remove = (id: string): void => {
    const doomed = findNode(nodes, id);
    if (!doomed) return;
    // A branch takes its subtree with it, which is what a delete means in a
    // tree and what the model's `nodeHolds` already answers.
    setItems(items.filter((item) => item.id !== id && item.parentId !== id));
  };

  return (
    <div className="flex flex-1">
      <div style={{ width }} className="border-border flex-none border-r">
        <TreeView<TreeSpecimenData>
          label="Files"
          rows={flattenTree(nodes, state.collapsed)}
          collapsed={state.collapsed}
          selectedId={selectedId}
          onSelect={(node) => setSelectedId(node.id)}
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
          renderTrailing={(node) =>
            node.data?.count ? (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {node.data.count}
              </Badge>
            ) : null
          }
          renderMenu={
            props.menu
              ? (node) => (
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => state.commands.beginRename(node.id)}
                    >
                      <Pencil />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => remove(node.id)}
                    >
                      <Trash2 />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                )
              : undefined
          }
          draggable={props.draggable}
          dragId={state.dragId}
          drop={state.drop}
          onDragStart={state.commands.onDragStart}
          onDragOver={state.commands.onDragOver}
          onDrop={state.commands.onDrop}
          onDragEnd={state.commands.onDragEnd}
          renamingId={props.renamable ? state.renamingId : undefined}
          onCommitRename={state.commands.commitRename}
          onCancelRename={state.commands.cancelRename}
        />
      </div>
      <TreeViewResizer width={width} onWidth={setWidth} />
      <div className="text-muted-foreground min-w-0 flex-1 px-4 text-sm">
        <p>
          Right-click a row for the menu. The verbs are this page's, not the
          component's: it takes a slot and wraps the row in a trigger only when
          one is given.
        </p>
        <p className="mt-2 text-xs">
          Drag the edge to resize, double-click it to reset. The handle reports
          the width and never clamps it, so bounds stay where the pane's owner
          put them.
        </p>
      </div>
    </div>
  );
};
