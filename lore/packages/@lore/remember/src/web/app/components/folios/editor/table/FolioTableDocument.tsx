import {
  Button,
  useDialog,
  useToast,
  cn,
  textLinkUnderlineClassName,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  currentProjectAtom,
  type I18n,
  type ElementRef,
  LoreViewer,
  loreDocsUrl,
  useElementLinks,
  WikiLinkHoverProvider,
} from "@lore/core/web";
import { z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useQueryParams } from "alepha/react/router";
import { Plus } from "lucide-react";
import {
  lazy,
  type ReactElement,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { FolioCellValue } from "../../../../../../api/schemas/folioCellValueSchema.ts";
import type { FolioRowResource } from "../../../../../../api/schemas/folioRowResourceSchema.ts";
import { folioDayKey, folioMoveToDay } from "./calendar/folioCalendarModel.ts";
import FolioTableColumnMenu from "./FolioTableColumnMenu.tsx";
import FolioTableRowSheet from "./FolioTableRowSheet.tsx";

/**
 * The calendar, a lazy chunk of its own (#Q3518).
 */
const FolioTableCalendar = lazy(
  () => import("./calendar/FolioTableCalendar.tsx"),
);

/**
 * Folio ▸ Import rows… (#Q3517), loaded when it opens.
 */
const FolioCsvImportDialog = lazy(() => import("./FolioCsvImportDialog.tsx"));
import FolioTableGrid from "./FolioTableGrid.tsx";
import { folioVisibleRows } from "./folioTableModel.ts";
import { useFolioTable } from "./useFolioTable.ts";

export interface FolioTableCommands {
  insertRow: () => void;
  insertColumn: () => void;
  find: () => void;
  importRows: () => void;
}

export interface FolioTableDocumentProps {
  folioId: string;
  readOnly: boolean;
  /**
   * A calendar folio (#Q3717): the same rows, shown as a month laid out by
   * its date column instead of a grid. A table is always its grid.
   */
  calendar?: boolean;
  /**
   * Receives the commands the menubar's Insert ▸ Row, Insert ▸ Column and
   * Edit ▸ Find in folio run, `null` on unmount.
   */
  onCommands?: (commands: FolioTableCommands | null) => void;
}

/**
 * A table folio's document pane (#Q3516): a find-and-sort bar over the
 * grid, which fills the pane edge to edge (#Q3716). A lazy chunk: a text
 * folio never loads it.
 *
 * The bar's find text and the sort are kept in the URL (`?find=`,
 * `?sort=`, `?dir=`), never stored: they are the reader's view, not the
 * folio's. Every write goes through `useFolioTable`, one row at a time with
 * its version; there is no Save button.
 */
const FolioTableDocument = (props: FolioTableDocumentProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const dateTime = useInject(DateTimeProvider);
  const table = useFolioTable(props.folioId);
  const findRef = useRef<HTMLDivElement>(null);
  const element = useMemo<ElementRef>(
    () => ({
      kind: "folio",
      projectId: project?.id ?? 0,
      projectSlug: project?.slug ?? "",
      id: props.folioId,
    }),
    [project?.id, project?.slug, props.folioId],
  );
  // The `[[#` picker's entries, for a reference cell's editor: the same
  // lookups the Markdown editor makes, so both offer the same items.
  const links = useElementLinks(element, "");
  const [importing, setImporting] = useState(false);
  const [openRowNumber, setOpenRowNumber] = useState<number | undefined>(
    undefined,
  );

  const [view, setView] = useQueryParams(
    z.object({
      find: z.string().optional(),
      sort: z.string().optional(),
      dir: z.enum(["asc", "desc"]).optional(),
      month: z.string().optional(),
    }),
    { format: "querystring" },
  );

  const findForm = useForm({
    schema: z.object({ find: z.string() }),
    initialValues: { find: view.find ?? "" },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) =>
      setView({ ...view, find: String(next ?? "") || undefined } as never),
  });

  const rows = useMemo(
    () =>
      folioVisibleRows(table.columns, table.rows, {
        q: view.find,
        sort: view.sort,
        dir: view.dir,
      }),
    [table.columns, table.rows, view.find, view.sort, view.dir],
  );

  const addColumn = async () => {
    const name = await dialog.prompt({
      title: tr("folios.table.column.add"),
      label: tr("folios.table.column.name"),
      validate: (value) =>
        value.trim().length < 1 || value.trim().length > 80
          ? tr("folios.table.column.name-invalid")
          : null,
    });
    if (name) {
      await table.setColumns([{ op: "add", name: name.trim(), type: "text" }]);
    }
  };

  const addRow = async (after?: number) => {
    await table.addRows([{ cells: {}, ...(after ? { after } : {}) }]);
  };

  const commands: FolioTableCommands = {
    insertRow: () => void addRow(),
    insertColumn: () => void addColumn(),
    find: () =>
      findRef.current?.querySelector<HTMLInputElement>("input")?.focus(),
    importRows: () => setImporting(true),
  };
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  useEffect(() => {
    props.onCommands?.({
      insertRow: () => commandsRef.current.insertRow(),
      insertColumn: () => commandsRef.current.insertColumn(),
      find: () => commandsRef.current.find(),
      importRows: () => commandsRef.current.importRows(),
    });
    return () => props.onCommands?.(null);
    // Registered once: the ref keeps the commands current.
  }, []);

  const writeCell = async (
    row: FolioRowResource,
    columnId: string,
    text: string,
  ) => {
    const ok = await table.writeCell(row, columnId, text === "" ? null : text);
    if (!ok) toaster.warning(tr("folios.table.conflict-toast"));
  };

  const paste = async (
    rowIndex: number,
    columnIndex: number,
    range: string[][],
  ) => {
    const edits: Array<{
      row: FolioRowResource;
      cells: Record<string, FolioCellValue | string>;
    }> = [];
    const extra: Array<{ cells: Record<string, unknown> }> = [];
    range.forEach((line, i) => {
      const cells: Record<string, string | null> = {};
      line.forEach((text, j) => {
        const column = table.columns[columnIndex + j];
        if (column) cells[column.id] = text === "" ? null : text;
      });
      const row = rows[rowIndex + i];
      if (row) edits.push({ row, cells: cells as Record<string, string> });
      else extra.push({ cells });
    });
    if (edits.length) await table.writeCells(edits);
    if (extra.length) await table.addRows(extra);
  };

  const deleteRows = async (chosen: FolioRowResource[]) => {
    const ok = await dialog.confirm({
      title: tr("folios.table.row.delete-title", {
        args: [String(chosen.length)],
      }),
      description: tr("folios.table.row.delete-body"),
      confirmLabel: tr("folios.table.row.delete"),
      destructive: true,
    });
    if (ok) await table.deleteRows(chosen.map((row) => row.number));
  };

  // The kind is the folio's (#Q3717), and the server says the same in
  // `view.kind`: a calendar left with no date column reads as a grid.
  const showCalendar =
    props.calendar === true && table.view.kind === "calendar";
  const month = /^\d{4}-\d{2}$/.test(view.month ?? "")
    ? (view.month as string)
    : folioDayKey(new Date(dateTime.nowMillis())).slice(0, 7);
  const openRow = rows.find((row) => row.number === openRowNumber);

  if (table.loading) {
    return (
      <div className="text-muted-foreground px-8 py-10 text-sm">
        {tr("folios.table.loading")}
      </div>
    );
  }

  const findLabel = props.calendar
    ? tr("folios.calendar.find")
    : tr("folios.table.find");

  const emptyHint = (
    <p className="text-muted-foreground px-3 py-4 text-sm">
      {props.readOnly
        ? tr("folios.table.empty-readonly")
        : tr("folios.table.empty")}{" "}
      <a
        href={loreDocsUrl("remember-tables")}
        target="_blank"
        rel="noreferrer"
        className={cn(textLinkUnderlineClassName, "hover:text-foreground")}
      >
        {tr("folios.table.docs")}
      </a>
    </p>
  );

  return (
    // The pane's full width and height (#Q3716): a bar the height of a text
    // folio's mode toolbar, then the grid edge to edge, scrolling inside.
    <div
      data-slot="folio-table"
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <div
        data-slot="folio-table-bar"
        className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-3"
      >
        <div ref={findRef} className="w-56 max-w-full">
          <Control
            input={findForm.input.find}
            label=""
            placeholder={findLabel}
            inputProps={{ "aria-label": findLabel }}
          />
        </div>
        <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
          {view.find
            ? tr("folios.table.count-filtered", {
                args: [String(rows.length), String(table.rows.length)],
              })
            : tr("folios.table.count", { args: [String(table.rows.length)] })}
        </span>
        <div className="flex-1" />
        {/* A calendar adds an entry on its day, never a row with no date. */}
        {!props.readOnly && !showCalendar && (
          <>
            <Button
              variant="outlined"
              size="sm"
              disabled={table.writing}
              onClick={() => void addColumn()}
            >
              <Plus className="size-3.5" />
              {tr("folios.table.column.add")}
            </Button>
            <Button
              size="sm"
              disabled={table.writing}
              onClick={() => void addRow()}
            >
              <Plus className="size-3.5" />
              {tr("folios.table.row.add")}
            </Button>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {showCalendar && table.view.dateColumnId ? (
          <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
            <Suspense fallback={null}>
              <FolioTableCalendar
                columns={table.columns}
                rows={rows}
                dateColumnId={table.view.dateColumnId}
                titleColumnId={table.view.titleColumnId}
                readOnly={props.readOnly}
                writing={table.writing}
                month={month}
                onMonth={(next) => setView({ ...view, month: next } as never)}
                onOpenRow={(row) => setOpenRowNumber(row.number)}
                onAddOnDay={(day) =>
                  void table.addRows([
                    { cells: { [table.view.dateColumnId!]: day } },
                  ])
                }
                onMoveToDay={(row, day) => {
                  const before = row.cells[table.view.dateColumnId!];
                  const next = folioMoveToDay(before, day);
                  if (next !== before) {
                    void writeCell(row, table.view.dateColumnId!, next);
                  }
                }}
              />
            </Suspense>
          </div>
        ) : table.columns.length === 0 ? (
          <p className="text-muted-foreground px-3 py-4 text-sm">
            {tr("folios.table.no-columns")}
          </p>
        ) : (
          // The hover card a reference cell's link opens, as in a text folio.
          <WikiLinkHoverProvider
            projectId={project?.id ?? 0}
            projectSlug={project?.slug ?? ""}
            attachments={[]}
            className="flex min-h-0 flex-1 flex-col"
          >
            <FolioTableGrid
              fill
              empty={table.rows.length === 0 ? emptyHint : undefined}
              columns={table.columns}
              rows={rows}
              readOnly={props.readOnly}
              writing={table.writing}
              conflicts={table.conflicts}
              renderHeader={(column) => (
                <FolioTableColumnMenu
                  column={column}
                  index={table.columns.indexOf(column)}
                  count={table.columns.length}
                  readOnly={props.readOnly}
                  disabled={table.writing}
                  sort={
                    view.sort === column.id ? (view.dir ?? "asc") : undefined
                  }
                  onSort={(direction) =>
                    setView({
                      ...view,
                      sort: direction ? column.id : undefined,
                      dir: direction === "desc" ? "desc" : undefined,
                    } as never)
                  }
                  onOperations={(operations) =>
                    void table.setColumns(operations)
                  }
                  retypePreview={(type) => table.retypePreview(column.id, type)}
                />
              )}
              onWriteCell={(row, columnId, text) =>
                void writeCell(row, columnId, text)
              }
              onPaste={(r, c, range) => void paste(r, c, range)}
              onClear={(cells) =>
                void table.writeCells(
                  cells.map((it) => ({
                    row: it.row,
                    cells: Object.fromEntries(
                      it.columnIds.map((id) => [id, null]),
                    ),
                  })),
                )
              }
              onInsertBelow={(row) => void addRow(row.number)}
              onDeleteRows={(chosen) => void deleteRows(chosen)}
              onMoveRow={(row, to) => void table.moveRow(row.number, to)}
              referenceSuggestions={links.suggestions}
              renderReference={(code) => (
                <LoreViewer
                  element={element}
                  content={`[[${code}]]`}
                  className="truncate [&_p]:m-0"
                />
              )}
            />
          </WikiLinkHoverProvider>
        )}
      </div>

      <FolioTableRowSheet
        columns={table.columns}
        referenceSuggestions={links.suggestions}
        row={openRow}
        readOnly={props.readOnly}
        onClose={() => setOpenRowNumber(undefined)}
        onWriteCell={(row, columnId, text) =>
          void writeCell(row, columnId, text)
        }
      />

      {importing && (
        <Suspense fallback={null}>
          <FolioCsvImportDialog
            open
            onOpenChange={setImporting}
            target={{
              kind: "into",
              folioId: props.folioId,
              columns: table.columns,
            }}
            onImported={() => void table.reload()}
          />
        </Suspense>
      )}
    </div>
  );
};

export default FolioTableDocument;
