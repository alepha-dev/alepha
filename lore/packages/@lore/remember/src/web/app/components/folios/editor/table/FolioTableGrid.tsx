import {
  Button,
  Checkbox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { AlertTriangle, GripVertical } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";
import type { FolioRowResource } from "../../../../../../api/schemas/folioRowResourceSchema.ts";
import FolioTableCellEditor from "./FolioTableCellEditor.tsx";
import {
  folioCellEditText,
  folioCellText,
  folioRangeToTsv,
  folioTsvToRange,
} from "./folioTableModel.ts";
import type { FolioCellConflict } from "./useFolioTable.ts";

export interface FolioTableGridProps {
  columns: FolioColumnResource[];
  /**
   * The rows to show, already filtered and sorted by the reader's view.
   */
  rows: FolioRowResource[];
  readOnly: boolean;
  /**
   * A write is in flight: writing controls are disabled.
   */
  writing?: boolean;
  conflicts: FolioCellConflict[];
  /**
   * The header cell of a column: its name and its menu, drawn by the
   * document, which owns the column operations.
   */
  renderHeader: (column: FolioColumnResource) => ReactNode;
  onWriteCell: (row: FolioRowResource, columnId: string, text: string) => void;
  /**
   * A pasted range, anchored at a cell: the document writes the rows it
   * covers and adds rows when it runs past the last.
   */
  onPaste: (rowIndex: number, columnIndex: number, range: string[][]) => void;
  onClear: (
    cells: Array<{ row: FolioRowResource; columnIds: string[] }>,
  ) => void;
  onInsertBelow: (row: FolioRowResource) => void;
  onDeleteRows: (rows: FolioRowResource[]) => void;
  onMoveRow: (
    row: FolioRowResource,
    to: { before?: number; after?: number },
  ) => void;
  /**
   * A reference cell's link, when the code names something the reader can
   * open.
   */
  renderReference?: (code: string) => ReactNode;
  /**
   * What a reference cell's editor offers, from the `[[#` picker.
   */
  referenceSuggestions?: Array<{ token: string; label: string }>;
  /**
   * Rows are drawn this tall, so the body can be virtualised.
   */
  rowHeight?: number;
  /**
   * How tall the scrolling body may grow before it scrolls. Ignored with
   * `fill`.
   */
  maxHeight?: number;
  /**
   * Fill the parent edge to edge, width and height, with no frame of its
   * own (#Q3716): the body takes the height left under the header and
   * scrolls inside itself. The parent must give the grid a height (a flex
   * child with `min-h-0`). Without it, the grid is a framed card whose body
   * grows up to `maxHeight`: a revision's preview.
   */
  fill?: boolean;
  /**
   * Shown in the body when there is no row: the empty state, under the
   * header rather than below a grid that fills the pane.
   */
  empty?: ReactNode;
}

interface CellPoint {
  r: number;
  c: number;
}

/**
 * A table folio as an editable grid (#Q3516).
 *
 * - **Cells** edit in place by type (`FolioTableCellEditor`); a checkbox
 *   toggles on click or Space.
 * - **Keyboard**: arrows move (Shift extends the selection), Enter edits and
 *   commits, Escape cancels, Tab moves right, typing on a focused cell
 *   starts editing with that character, Delete empties the selection, and
 *   ⌘C / ⌘V copy and paste a cell or a rectangular range as tab-separated
 *   text, so a range travels to and from a spreadsheet.
 * - **Rows** are virtualised: only the rows in view (and a margin) are in
 *   the DOM, so a full table of 2,000 rows scrolls like a short one.
 * - **Read-only** for a member without `folio:write`: no editor, no menu, no
 *   drag handle.
 *
 * Logical utilities throughout (`ps`, `pe`, `start`, `end`), so the grid
 * reads right to left.
 */
const FolioTableGrid = (props: FolioTableGridProps): ReactElement => {
  const { tr, l } = useI18n<I18n, "en">();
  const rowHeight = props.rowHeight ?? 36;
  const gridRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Filling the pane, the window of rows drawn is the body's own height,
  // measured, since nothing caps it.
  const [measured, setMeasured] = useState(640);
  useEffect(() => {
    const body = bodyRef.current;
    if (!props.fill || !body || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (body.clientHeight > 0) setMeasured(body.clientHeight);
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [props.fill]);
  const maxHeight = props.fill ? measured : (props.maxHeight ?? 640);
  const [scrollTop, setScrollTop] = useState(0);
  const [focus, setFocus] = useState<CellPoint | undefined>(undefined);
  const [anchor, setAnchor] = useState<CellPoint | undefined>(undefined);
  const [editing, setEditing] = useState<
    { point: CellPoint; initial: string } | undefined
  >(undefined);
  const [dragging, setDragging] = useState<number | undefined>(undefined);

  const rowCount = props.rows.length;
  const columnCount = props.columns.length;
  const overscan = 8;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(
    rowCount,
    Math.ceil((scrollTop + maxHeight) / rowHeight) + overscan,
  );
  const template = `3.5rem repeat(${Math.max(columnCount, 1)}, minmax(9rem, 1fr))`;
  // Wider than the pane when there are many columns: the header and the
  // body scroll sideways together, inside the grid's own frame.
  const minWidth = `calc(3.5rem + ${Math.max(columnCount, 1)} * 9rem)`;

  const selection = ():
    | { top: number; bottom: number; left: number; right: number }
    | undefined => {
    if (!focus) return undefined;
    const from = anchor ?? focus;
    return {
      top: Math.min(from.r, focus.r),
      bottom: Math.max(from.r, focus.r),
      left: Math.min(from.c, focus.c),
      right: Math.max(from.c, focus.c),
    };
  };

  const isSelected = (point: CellPoint): boolean => {
    const range = selection();
    return (
      !!range &&
      point.r >= range.top &&
      point.r <= range.bottom &&
      point.c >= range.left &&
      point.c <= range.right
    );
  };

  const scrollIntoView = (r: number) => {
    const body = bodyRef.current;
    if (!body) return;
    const top = r * rowHeight;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (top + rowHeight > body.scrollTop + body.clientHeight) {
      body.scrollTop = top + rowHeight - body.clientHeight;
    }
  };

  const moveTo = (point: CellPoint, extend = false) => {
    const next = {
      r: Math.max(0, Math.min(rowCount - 1, point.r)),
      c: Math.max(0, Math.min(columnCount - 1, point.c)),
    };
    if (extend) setAnchor((current) => current ?? focus);
    else setAnchor(undefined);
    setFocus(next);
    scrollIntoView(next.r);
  };

  const conflictOf = (row: FolioRowResource, column: FolioColumnResource) =>
    props.conflicts.find(
      (it) => it.rowNumber === row.number && it.columnId === column.id,
    );

  const startEditing = (point: CellPoint, initial?: string) => {
    if (props.readOnly) return;
    const row = props.rows[point.r];
    const column = props.columns[point.c];
    if (!row || !column) return;
    if (column.type === "checkbox") {
      props.onWriteCell(
        row,
        column.id,
        row.cells[column.id] === true ? "false" : "true",
      );
      return;
    }
    const conflict = conflictOf(row, column);
    setEditing({
      point,
      initial:
        initial ??
        conflict?.value ??
        folioCellEditText(column, row.cells[column.id] ?? null),
    });
  };

  const commit = (value: string, move: "down" | "right" | "none") => {
    if (!editing) return;
    const row = props.rows[editing.point.r];
    const column = props.columns[editing.point.c];
    const point = editing.point;
    setEditing(undefined);
    if (row && column) {
      const before = folioCellEditText(column, row.cells[column.id] ?? null);
      if (value !== before || conflictOf(row, column)) {
        props.onWriteCell(row, column.id, value);
      }
    }
    if (move === "down") moveTo({ r: point.r + 1, c: point.c });
    if (move === "right") moveTo({ r: point.r, c: point.c + 1 });
    gridRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || rowCount === 0 || columnCount === 0) return;
    const at = focus ?? { r: 0, c: 0 };
    const extend = event.shiftKey;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTo({ r: at.r + 1, c: at.c }, extend);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveTo({ r: at.r - 1, c: at.c }, extend);
        return;
      case "ArrowRight":
        event.preventDefault();
        moveTo({ r: at.r, c: at.c + 1 }, extend);
        return;
      case "ArrowLeft":
        event.preventDefault();
        moveTo({ r: at.r, c: at.c - 1 }, extend);
        return;
      case "Tab":
        event.preventDefault();
        moveTo({ r: at.r, c: at.c + (event.shiftKey ? -1 : 1) });
        return;
      case "Enter":
      case "F2":
        event.preventDefault();
        if (!focus) moveTo(at);
        startEditing(at);
        return;
      case " ":
        if (props.columns[at.c]?.type === "checkbox") {
          event.preventDefault();
          startEditing(at);
        }
        return;
      case "Escape":
        setAnchor(undefined);
        return;
      case "Delete":
      case "Backspace": {
        if (props.readOnly) return;
        event.preventDefault();
        const range = selection() ?? {
          top: at.r,
          bottom: at.r,
          left: at.c,
          right: at.c,
        };
        props.onClear(
          props.rows.slice(range.top, range.bottom + 1).map((row) => ({
            row,
            columnIds: props.columns
              .slice(range.left, range.right + 1)
              .map((column) => column.id),
          })),
        );
        return;
      }
    }
    // Typing on a focused cell starts editing with that character.
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const column = props.columns[at.c];
      if (column && column.type !== "checkbox" && column.type !== "select") {
        event.preventDefault();
        if (!focus) moveTo(at);
        // A date is picked, never typed: the key opens the picker on the
        // cell's value, since a picker handed "2" cannot read it as a date.
        startEditing(at, column.type === "date" ? undefined : event.key);
      }
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const range = selection();
    if (!range) return;
    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      folioRangeToTsv(
        props.rows
          .slice(range.top, range.bottom + 1)
          .map((row) =>
            props.columns
              .slice(range.left, range.right + 1)
              .map((column) =>
                folioCellEditText(column, row.cells[column.id] ?? null),
              ),
          ),
      ),
    );
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing || props.readOnly || !focus) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const range = selection() ?? { top: focus.r, left: focus.c };
    props.onPaste(range.top, range.left, folioTsvToRange(text));
  };

  const renderCell = (
    row: FolioRowResource,
    column: FolioColumnResource,
    point: CellPoint,
  ): ReactNode => {
    if (editing && editing.point.r === point.r && editing.point.c === point.c) {
      return (
        <FolioTableCellEditor
          column={column}
          initial={editing.initial}
          referenceSuggestions={props.referenceSuggestions}
          onCommit={commit}
          onCancel={() => {
            setEditing(undefined);
            gridRef.current?.focus();
          }}
        />
      );
    }
    const value = row.cells[column.id] ?? null;
    if (column.type === "checkbox") {
      return (
        <Checkbox
          checked={value === true}
          disabled={props.readOnly || props.writing}
          aria-label={column.name}
          onCheckedChange={() => startEditing(point)}
        />
      );
    }
    if (column.type === "reference" && typeof value === "string") {
      return props.renderReference ? props.renderReference(value) : value;
    }
    if (column.type === "number" && typeof value === "number") {
      return <span className="tabular-nums">{l(value)}</span>;
    }
    return folioCellText(column, value);
  };

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-rowcount={rowCount + 1}
      aria-colcount={columnCount + 1}
      aria-readonly={props.readOnly || undefined}
      tabIndex={0}
      data-slot="folio-grid"
      className={cn(
        "focus-visible:ring-ring/50 overflow-x-auto text-sm outline-none focus-visible:ring-2",
        props.fill
          ? "flex h-full min-h-0 flex-col focus-visible:ring-inset"
          : "border-border rounded-md border",
      )}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onPaste={onPaste}
      onFocus={(event) => {
        if (event.target === gridRef.current && !focus && rowCount > 0) {
          setFocus({ r: 0, c: 0 });
        }
      }}
    >
      <div
        role="row"
        aria-rowindex={1}
        className="bg-muted/40 border-border grid shrink-0 border-b font-medium"
        style={{ gridTemplateColumns: template, minWidth }}
      >
        <div
          role="columnheader"
          className="text-muted-foreground flex items-center px-2 text-xs"
        >
          #
        </div>
        {props.columns.map((column) => (
          <div
            key={column.id}
            role="columnheader"
            className="border-border flex min-w-0 items-center border-s"
          >
            {props.renderHeader(column)}
          </div>
        ))}
      </div>

      <div
        ref={bodyRef}
        data-slot="folio-grid-body"
        className={cn(
          "relative overflow-x-hidden overflow-y-auto",
          props.fill && "min-h-0 flex-1",
        )}
        style={props.fill ? { minWidth } : { maxHeight, minWidth }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {rowCount === 0 && props.empty}
        <div style={{ height: rowCount * rowHeight, position: "relative" }}>
          {props.rows.slice(first, last).map((row, offset) => {
            const r = first + offset;
            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={r + 2}
                data-row-number={row.number}
                className={cn(
                  "border-border absolute inset-x-0 grid border-b",
                  dragging === row.number && "opacity-50",
                )}
                style={{
                  gridTemplateColumns: template,
                  top: r * rowHeight,
                  height: rowHeight,
                }}
                onDragOver={(event) => {
                  if (dragging !== undefined) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const moved = props.rows.find((it) => it.number === dragging);
                  setDragging(undefined);
                  if (!moved || moved.number === row.number) return;
                  const from = props.rows.indexOf(moved);
                  props.onMoveRow(
                    moved,
                    from < r ? { after: row.number } : { before: row.number },
                  );
                }}
              >
                <div
                  role="rowheader"
                  className="text-muted-foreground flex items-center gap-0.5 ps-1 text-xs tabular-nums"
                >
                  {!props.readOnly && (
                    <span
                      draggable
                      aria-hidden
                      className="cursor-grab"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDragging(row.number);
                      }}
                      onDragEnd={() => setDragging(undefined)}
                    >
                      <GripVertical className="size-3" />
                    </span>
                  )}
                  {props.readOnly ? (
                    row.number
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="minimal"
                            size="sm"
                            className="h-6 px-1 text-xs tabular-nums"
                            aria-label={tr("folios.table.row.menu", {
                              args: [String(row.number)],
                            })}
                            disabled={props.writing}
                          />
                        }
                      >
                        {row.number}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onClick={() => props.onInsertBelow(row)}
                        >
                          {tr("folios.table.row.insert-below")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            const range = selection();
                            const chosen =
                              range && range.top <= r && r <= range.bottom
                                ? props.rows.slice(range.top, range.bottom + 1)
                                : [row];
                            props.onDeleteRows(chosen);
                          }}
                        >
                          {tr("folios.table.row.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {props.columns.map((column, c) => {
                  const point = { r, c };
                  const focused = focus?.r === r && focus?.c === c;
                  const conflict = conflictOf(row, column);
                  return (
                    // A grid cell: the grid's keyboard handler drives it.
                    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                    <div
                      key={column.id}
                      role="gridcell"
                      tabIndex={-1}
                      aria-selected={isSelected(point)}
                      aria-label={`${column.name}, ${tr("folios.table.row.label", { args: [String(row.number)] })}`}
                      data-column-id={column.id}
                      className={cn(
                        "border-border flex min-w-0 items-center truncate border-s px-2",
                        isSelected(point) && "bg-primary/5",
                        focused && "ring-primary ring-2 ring-inset",
                        conflict && "bg-warning/10",
                      )}
                      onClick={(event) => {
                        moveTo(point, event.shiftKey);
                        gridRef.current?.focus();
                      }}
                      onDoubleClick={() => startEditing(point)}
                    >
                      {conflict && !editing && (
                        <span
                          className="text-warning me-1 shrink-0"
                          title={tr("folios.table.conflict")}
                        >
                          <AlertTriangle className="size-3.5" />
                        </span>
                      )}
                      {conflict &&
                      !(editing?.point.r === r && editing?.point.c === c)
                        ? conflict.value
                        : renderCell(row, column, point)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FolioTableGrid;
