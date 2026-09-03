import { Button } from "@alepha/ui/components/ui/button";
import { useDroppable } from "@dnd-kit/core";
import { useI18n } from "alepha/react/i18n";
import { ChevronsLeftRight } from "lucide-react";
import { useMemo, useState } from "react";

import type { PaletteColor } from "@/api/schemas/paletteColorSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import type { I18n } from "../../services/I18n.ts";
import type { ProjectUser } from "../shared/useProjectUsers.ts";
import KanbanCard from "./KanbanCard.tsx";
import KanbanColumnComposer from "./KanbanColumnComposer.tsx";
import KanbanColumnMenu from "./KanbanColumnMenu.tsx";

const PAGE_SIZE = 20;

export type ColumnKind = "new" | "accepted" | "completed";

export interface ColumnDescriptor {
  /**
   * Stable droppable id.
   */
  key: string;
  /**
   * Free-form sub-column name when `kind === "accepted"`.
   */
  subColumn?: string;
  /**
   * Display label (already translated).
   */
  label: string;
  /**
   * Tailwind class for the small status dot in the header.
   */
  dotClass: string;
  /**
   * Which lifecycle state a card dropped here collapses to. The lifecycle
   * triple stays the truth; this is the column's mapping onto it.
   */
  kind: ColumnKind;
  /**
   * Soft cap. The header reads `3/5` past nothing and warns on a drop past
   * it; it never refuses.
   */
  wipLimit?: number;
  /**
   * The operator's chosen dot colour, when they chose one. Carried beside
   * `dotClass` rather than folded into it because the header's menu has to
   * show WHICH token is selected, and a resolved class cannot be compared
   * back to a token.
   */
  color?: PaletteColor;
  /**
   * `false` for the ends the board synthesizes. A synthesized lane has no
   * entry in `kanbanColumns`, so there is nothing to rename, recolour or
   * delete - which is what decides whether the header carries a menu.
   */
  editable?: boolean;
}

export interface KanbanColumnProps {
  descriptor: ColumnDescriptor;
  quests: QuestResource[];
  last?: boolean;
  onSelect: (quest: QuestResource) => void;
  /**
   * Area name → dot class. Resolved once by the board for the whole set,
   * so a column of 20 cards does not rebuild the lookup 20 times.
   */
  areaDotClass: (area: string) => string;
  /**
   * The project's tag → colour map, passed straight through to the card.
   */
  tagColors?: Record<string, PaletteColor>;
  /**
   * Ids of quests whose predecessor is not complete. Computed by the board
   * because the rule needs every quest, not just this column's.
   */
  blockedIds?: Set<number>;
  /**
   * Resolves `acceptedBy` to a member, for the card's avatar.
   */
  assigneeOf: (quest: QuestResource) => ProjectUser | undefined;
  /**
   * Creates a card at one end of THIS column. Absent on a column that
   * cannot compose — Completed, where a card would have to be created and
   * immediately finished to belong there.
   */
  onCompose?: (title: string, position: "head" | "foot") => Promise<void>;
  /**
   * How long each card has sat here, by quest id.
   */
  agingOf: (quest: QuestResource) => "fresh" | "aging" | "stale";
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * Column management from the board itself (#1511). Absent for a reader
   * who cannot manage columns, which is what keeps the header from offering
   * an action the server would refuse.
   */
  onRename?: (name: string) => void;
  onColor?: (color: PaletteColor | undefined) => void;
  onDelete?: () => void;
  /**
   * True while one of the three is in flight, for this column only.
   */
  busy?: boolean;
}

const KanbanColumn = (props: KanbanColumnProps) => {
  const { descriptor, quests, last, onSelect } = props;
  const { tr } = useI18n<I18n, "en">();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [renaming, setRenaming] = useState(false);
  const { setNodeRef, isOver } = useDroppable({
    id: descriptor.key,
    data: {
      type: "column",
      kind: descriptor.kind,
      subColumn: descriptor.subColumn,
    },
  });

  const visibleQuests = useMemo(
    () => quests.slice(0, visibleCount),
    [quests, visibleCount],
  );
  const hasMore = quests.length > visibleCount;

  // A collapsed column keeps its header, rotated into a narrow strip, so a
  // five-column board fits a laptop without horizontal scrolling. It is
  // NOT a droppable while collapsed: dropping into a lane you cannot see
  // the contents of is a move you cannot check.
  if (props.collapsed) {
    return (
      <button
        type="button"
        data-testid="kanban-column"
        data-column-key={descriptor.key}
        data-collapsed="true"
        aria-label={descriptor.label}
        onClick={props.onToggleCollapsed}
        className={`hover:bg-muted flex w-10 shrink-0 flex-col items-center gap-2 py-2 transition-colors ${
          last ? "" : "border-border border-r"
        }`}
      >
        <span
          className={`size-2 shrink-0 rounded-full ${descriptor.dotClass}`}
        />
        <span className="text-muted-foreground text-xs">{quests.length}</span>
        <span
          className="text-muted-foreground truncate text-xs font-semibold"
          style={{ writingMode: "vertical-rl" }}
        >
          {descriptor.label}
        </span>
      </button>
    );
  }

  return (
    <div
      data-testid="kanban-column"
      data-column-key={descriptor.key}
      className={`flex min-w-[260px] flex-1 flex-col overflow-hidden ${
        last ? "" : "border-border border-r"
      }`}
    >
      {/* Column header */}
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <span
          className={`size-2 shrink-0 rounded-full ${descriptor.dotClass}`}
        />
        {renaming ? (
          // Renamed in place rather than in a dialog: the field IS the
          // header, so there is nothing to read the old name off while
          // typing the new one.
          <input
            // Focused through a ref rather than `autoFocus`, which
            // `jsx-a11y/no-autofocus` refuses: the field only exists because
            // the operator just asked to rename, so landing in it is the
            // point, but the attribute would also steal focus on any
            // re-render that remounts the input.
            ref={(el) => el?.focus()}
            data-testid="kanban-column-rename-input"
            aria-label={String(tr("kanban.column.rename"))}
            defaultValue={descriptor.label}
            maxLength={24}
            className="border-input focus-visible:border-ring min-w-0 flex-1 rounded border bg-transparent px-1 text-sm font-semibold outline-none"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                props.onRename?.(event.currentTarget.value);
                setRenaming(false);
              }
              if (event.key === "Escape") setRenaming(false);
            }}
            onBlur={(event) => {
              props.onRename?.(event.currentTarget.value);
              setRenaming(false);
            }}
          />
        ) : (
          <span className="truncate text-sm font-semibold">
            {descriptor.label}
          </span>
        )}
        <span
          data-testid="kanban-column-count"
          data-over-limit={
            descriptor.wipLimit != null && quests.length > descriptor.wipLimit
          }
          className={`text-xs ${
            descriptor.wipLimit != null && quests.length > descriptor.wipLimit
              ? "font-semibold text-amber-500"
              : "text-muted-foreground"
          }`}
        >
          {descriptor.wipLimit != null
            ? `${quests.length}/${descriptor.wipLimit}`
            : quests.length}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Only on a configured, in-progress column, and only for someone
              who can manage them: a synthesized lane has nothing to rename
              and a member would get a 403. */}
          {descriptor.editable && props.onRename && (
            <KanbanColumnMenu
              name={descriptor.label}
              color={descriptor.color}
              busy={props.busy}
              onRename={() => setRenaming(true)}
              onColor={(color) => props.onColor?.(color)}
              onDelete={() => props.onDelete?.()}
            />
          )}
          {props.onToggleCollapsed && (
            <button
              type="button"
              data-testid="kanban-column-collapse"
              aria-label={String(tr("kanban.column.collapse"))}
              // A 24x24 box around a 14px glyph, WCAG 2.2 Target Size
              // (Minimum). It was a bare button the size of its icon, so the
              // whole target was 14x14 - workable with a mouse, never with a
              // thumb, and the same on a desktop as on a phone.
              //
              // Grown rather than given a `::before` overlay: this button and
              // the menu beside it are 20px apart centre to centre, so two
              // invisible 24px overlays would intersect and whichever painted
              // last would swallow the other's edge. Two real 24px boxes with
              // the row's 6px gap between them do not. It costs the header
              // 4px of height and the title 20px it truncates anyway.
              className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
              onClick={props.onToggleCollapsed}
            >
              <ChevronsLeftRight className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Column body — scrollable */}
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto transition-colors ${
          isOver ? "bg-green-500/10" : ""
        }`}
      >
        <div className="flex min-h-[100px] flex-col gap-0.5 p-1">
          {props.onCompose && (
            <KanbanColumnComposer
              position="head"
              onCreate={(title) => props.onCompose!(title, "head")}
            />
          )}
          {quests.length === 0 && (
            <div className="flex items-center justify-center py-8 opacity-40">
              <span className="text-muted-foreground text-sm">
                {tr("kanban.empty")}
              </span>
            </div>
          )}
          {visibleQuests.map((quest) => (
            <KanbanCard
              key={quest.id}
              quest={quest}
              onSelect={onSelect}
              areaDotClass={props.areaDotClass(quest.area)}
              tagColors={props.tagColors}
              blocked={props.blockedIds?.has(quest.id)}
              assignee={props.assigneeOf(quest)}
              aging={props.agingOf(quest)}
            />
          ))}
          {props.onCompose && quests.length > 0 && (
            <KanbanColumnComposer
              position="foot"
              onCreate={(title) => props.onCompose!(title, "foot")}
            />
          )}
          {hasMore && (
            <div className="flex justify-center py-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                {tr("kanban.showMore")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KanbanColumn;
