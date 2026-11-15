import { Button, useDialog, useToast } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  currentProjectAtom,
  type I18n,
  type ElementRef,
  LoreViewer,
  useElementLinks,
  WikiLinkHoverProvider,
} from "@lore/core/web";
import { z } from "alepha";
import { useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useQueryParams } from "alepha/react/router";
import { Plus } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef } from "react";

import type { FolioCellValue } from "../../../../../../api/schemas/folioCellValueSchema.ts";
import type { FolioRowResource } from "../../../../../../api/schemas/folioRowResourceSchema.ts";
import FolioTableColumnMenu from "./FolioTableColumnMenu.tsx";
import FolioTableGrid from "./FolioTableGrid.tsx";
import { folioVisibleRows } from "./folioTableModel.ts";
import { useFolioTable } from "./useFolioTable.ts";

export interface FolioTableCommands {
  insertRow: () => void;
  insertColumn: () => void;
  find: () => void;
}

export interface FolioTableDocumentProps {
  folioId: string;
  readOnly: boolean;
  /**
   * Receives the commands the menubar's Insert ▸ Row, Insert ▸ Column and
   * Edit ▸ Find in folio run, `null` on unmount.
   */
  onCommands?: (commands: FolioTableCommands | null) => void;
}

/**
 * A table folio's document pane (#Q3516): a find-and-sort bar over the
 * grid. A lazy chunk: a text folio never loads it.
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

  const [view, setView] = useQueryParams(
    z.object({
      find: z.string().optional(),
      sort: z.string().optional(),
      dir: z.enum(["asc", "desc"]).optional(),
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
  };
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  useEffect(() => {
    props.onCommands?.({
      insertRow: () => commandsRef.current.insertRow(),
      insertColumn: () => commandsRef.current.insertColumn(),
      find: () => commandsRef.current.find(),
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

  if (table.loading) {
    return (
      <div className="text-muted-foreground px-8 py-10 text-sm">
        {tr("folios.table.loading")}
      </div>
    );
  }

  return (
    <div data-slot="folio-table" className="flex flex-col gap-3 px-6 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <div ref={findRef} className="w-64 max-w-full">
          <Control
            input={findForm.input.find}
            label=""
            placeholder={tr("folios.table.find")}
            inputProps={{ "aria-label": tr("folios.table.find") }}
          />
        </div>
        <span className="text-muted-foreground text-xs tabular-nums">
          {view.find
            ? tr("folios.table.count-filtered", {
                args: [String(rows.length), String(table.rows.length)],
              })
            : tr("folios.table.count", { args: [String(table.rows.length)] })}
        </span>
        <div className="flex-1" />
        {!props.readOnly && (
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

      {table.columns.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tr("folios.table.no-columns")}
        </p>
      ) : (
        // The hover card a reference cell's link opens, as in a text folio.
        <WikiLinkHoverProvider
          projectId={project?.id ?? 0}
          projectSlug={project?.slug ?? ""}
          attachments={[]}
        >
          <FolioTableGrid
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
                sort={view.sort === column.id ? (view.dir ?? "asc") : undefined}
                onSort={(direction) =>
                  setView({
                    ...view,
                    sort: direction ? column.id : undefined,
                    dir: direction === "desc" ? "desc" : undefined,
                  } as never)
                }
                onOperations={(operations) => void table.setColumns(operations)}
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

      {table.rows.length === 0 && table.columns.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {props.readOnly
            ? tr("folios.table.empty-readonly")
            : tr("folios.table.empty")}
        </p>
      )}
    </div>
  );
};

export default FolioTableDocument;
