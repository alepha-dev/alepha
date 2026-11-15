import { useAction, useClient, useQuery } from "alepha/react";
import { useRef, useState } from "react";

import type { FolioTableController } from "../../../../../../api/controllers/FolioTableController.ts";
import type { FolioCellValue } from "../../../../../../api/schemas/folioCellValueSchema.ts";
import type { FolioColumnOperation } from "../../../../../../api/schemas/folioColumnOperationSchema.ts";
import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";
import type { FolioRowResource } from "../../../../../../api/schemas/folioRowResourceSchema.ts";

/**
 * A cell whose write was refused because its row changed since it was read
 * (409): the row is reloaded and the value the person typed is kept here,
 * marked, so nothing typed is lost.
 */
export interface FolioCellConflict {
  rowNumber: number;
  columnId: string;
  value: string;
}

export interface UseFolioTableResult {
  loading: boolean;
  columns: FolioColumnResource[];
  rows: FolioRowResource[];
  conflicts: FolioCellConflict[];
  /**
   * True while any write is in flight: every control of the grid that
   * writes is disabled on it, page-wide.
   */
  writing: boolean;
  writeCell: (
    row: FolioRowResource,
    columnId: string,
    value: FolioCellValue | string,
  ) => Promise<boolean>;
  writeCells: (
    edits: Array<{
      row: FolioRowResource;
      cells: Record<string, FolioCellValue | string>;
    }>,
  ) => Promise<void>;
  addRows: (
    rows: Array<{ cells: Record<string, unknown>; after?: number }>,
  ) => Promise<FolioRowResource[]>;
  deleteRows: (numbers: number[]) => Promise<void>;
  moveRow: (
    number: number,
    to: { before?: number; after?: number },
  ) => Promise<void>;
  setColumns: (operations: FolioColumnOperation[]) => Promise<boolean>;
  retypePreview: (
    columnId: string,
    type: FolioColumnResource["type"],
  ) => Promise<number>;
  dismissConflict: (rowNumber: number, columnId: string) => void;
  reload: () => Promise<void>;
}

/**
 * A table folio's columns and rows for the grid (#Q3516): one read of the
 * whole table (2,000 rows at most), then every write answers what it wrote
 * and is merged in place, so the grid never re-reads after a write.
 */
export const useFolioTable = (folioId: string): UseFolioTableResult => {
  const api = useClient<FolioTableController>();
  const [columns, setColumnsState] = useState<FolioColumnResource[]>([]);
  const [rows, setRows] = useState<FolioRowResource[]>([]);
  const [conflicts, setConflicts] = useState<FolioCellConflict[]>([]);

  const query = useQuery(
    {
      key: ["folio-table", folioId],
      handler: async () =>
        api.getFolioTable({ params: { id: folioId }, query: { limit: 2000 } }),
    },
    [api, folioId],
  );

  // A fresh read replaces the local copy, synced during render rather than
  // from an effect, so the two never disagree for a frame.
  const [loaded, setLoaded] = useState<typeof query.data>(undefined);
  if (query.data && query.data !== loaded) {
    setLoaded(query.data);
    setColumnsState(query.data.columns);
    setRows(query.data.rows);
  }

  // What each row's version became after this tab wrote it, keyed by the
  // version the write was based on. The grid can still hold that older copy
  // when its next write is queued; sent as it is, it would be a conflict with
  // the tab's own write. A row reloaded at any other version is sent as is,
  // so a revert, which can lower a version, is never misread.
  const versions = useRef(new Map<number, { from: number; to: number }>());
  // Cell writes run one after another: `useAction` refuses a run while one
  // is in flight, and a second cell committed before the first answered
  // would otherwise be dropped without a word.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(work, work);
    queue.current = next.catch(() => undefined);
    return next;
  };
  const latest = (row: FolioRowResource): FolioRowResource => {
    const known = versions.current.get(row.number);
    return known && known.from === row.version
      ? { ...row, version: known.to }
      : row;
  };
  const wrote = (base: FolioRowResource, answer: FolioRowResource) =>
    versions.current.set(answer.number, {
      from: base.version,
      to: answer.version,
    });

  const merge = (written: FolioRowResource[]) => {
    setRows((current) => {
      const byNumber = new Map(written.map((row) => [row.number, row]));
      const kept = current.map((row) => byNumber.get(row.number) ?? row);
      const known = new Set(current.map((row) => row.number));
      return [...kept, ...written.filter((row) => !known.has(row.number))];
    });
  };

  const status = (error: unknown): number | undefined =>
    typeof error === "object" && error !== null
      ? ((error as { status?: number }).status ??
        (error as { data?: { status?: number } }).data?.status)
      : undefined;

  const writeCellAction = useAction<
    [row: FolioRowResource, columnId: string, value: unknown],
    boolean
  >(
    {
      handler: async (_ctx, base, columnId, value) => {
        const row = latest(base);
        try {
          const answer = await api.updateFolioRow({
            params: { id: folioId, number: row.number },
            body: { cells: { [columnId]: value }, version: row.version },
          });
          wrote(base, answer.row);
          merge([answer.row]);
          setConflicts((current) =>
            current.filter(
              (it) =>
                !(it.rowNumber === row.number && it.columnId === columnId),
            ),
          );
          return true;
        } catch (error) {
          if (status(error) !== 409) throw error;
          // The row moved under us: reload it, keep what was typed.
          const table = await api.getFolioTable({
            params: { id: folioId },
            query: { limit: 2000 },
          });
          setRows(table.rows);
          setConflicts((current) => [
            ...current.filter(
              (it) =>
                !(it.rowNumber === row.number && it.columnId === columnId),
            ),
            {
              rowNumber: row.number,
              columnId,
              value:
                value === null || value === undefined
                  ? ""
                  : typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value as string | number | boolean),
            },
          ]);
          return false;
        }
      },
    },
    [api, folioId],
  );

  const writeCellsAction = useAction<
    [
      edits: Array<{
        row: FolioRowResource;
        cells: Record<string, unknown>;
      }>,
    ],
    void
  >(
    {
      handler: async (_ctx, edits) => {
        const written: FolioRowResource[] = [];
        for (const edit of edits) {
          const answer = await api.updateFolioRow({
            params: { id: folioId, number: edit.row.number },
            body: { cells: edit.cells, version: latest(edit.row).version },
          });
          wrote(edit.row, answer.row);
          written.push(answer.row);
        }
        merge(written);
      },
    },
    [api, folioId],
  );

  const addRowsAction = useAction<
    [rows: Array<{ cells: Record<string, unknown>; after?: number }>],
    FolioRowResource[]
  >(
    {
      handler: async (_ctx, input) => {
        const answer = await api.addFolioRows({
          params: { id: folioId },
          body: { rows: input },
        });
        merge(answer.rows);
        return answer.rows;
      },
    },
    [api, folioId],
  );

  const deleteRowsAction = useAction<[numbers: number[]], void>(
    {
      handler: async (_ctx, numbers) => {
        const answer = await api.deleteFolioRows({
          params: { id: folioId },
          body: { numbers },
        });
        const gone = new Set(answer.deleted);
        setRows((current) => current.filter((row) => !gone.has(row.number)));
      },
    },
    [api, folioId],
  );

  const moveRowAction = useAction<
    [number: number, to: { before?: number; after?: number }],
    void
  >(
    {
      handler: async (_ctx, number, to) => {
        const answer = await api.moveFolioRow({
          params: { id: folioId, number },
          body: to,
        });
        merge([answer.row]);
      },
    },
    [api, folioId],
  );

  const setColumnsAction = useAction<
    [operations: FolioColumnOperation[]],
    void
  >(
    {
      handler: async (_ctx, operations) => {
        const answer = await api.setFolioColumns({
          params: { id: folioId },
          body: { operations },
        });
        setColumnsState(answer.columns);
        // A retype or a removal changes how every row reads: re-read once.
        if (operations.some((op) => op.op !== "rename" && op.op !== "move")) {
          const table = await api.getFolioTable({
            params: { id: folioId },
            query: { limit: 2000 },
          });
          setRows(table.rows);
        }
      },
    },
    [api, folioId],
  );

  const previewAction = useAction<
    [columnId: string, type: FolioColumnResource["type"]],
    number
  >(
    {
      handler: async (_ctx, columnId, type) =>
        (
          await api.previewFolioColumnRetype({
            params: { id: folioId, column: columnId },
            query: { type },
          })
        ).lost,
    },
    [api, folioId],
  );

  const writing =
    writeCellAction.loading ||
    writeCellsAction.loading ||
    addRowsAction.loading ||
    deleteRowsAction.loading ||
    moveRowAction.loading ||
    setColumnsAction.loading;

  return {
    loading: query.loading && !query.data,
    columns,
    rows,
    conflicts,
    writing,
    writeCell: async (row, columnId, value) => {
      const result = await enqueue(() =>
        writeCellAction.run(row, columnId, value),
      );
      return result.ok ? result.value : false;
    },
    writeCells: async (edits) => {
      await enqueue(() => writeCellsAction.run(edits));
    },
    addRows: async (input) => {
      const result = await addRowsAction.run(input);
      return result.ok ? result.value : [];
    },
    deleteRows: async (numbers) => {
      await deleteRowsAction.run(numbers);
    },
    moveRow: async (number, to) => {
      await moveRowAction.run(number, to);
    },
    setColumns: async (operations) => {
      const result = await setColumnsAction.run(operations);
      return result.ok;
    },
    retypePreview: async (columnId, type) => {
      const result = await previewAction.run(columnId, type);
      return result.ok ? result.value : 0;
    },
    dismissConflict: (rowNumber, columnId) =>
      setConflicts((current) =>
        current.filter(
          (it) => !(it.rowNumber === rowNumber && it.columnId === columnId),
        ),
      ),
    reload: async () => {
      await query.refetch();
    },
  };
};
