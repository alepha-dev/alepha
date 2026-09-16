import { useRouter } from "alepha/react/router";
import { useMemo } from "react";

import type { AppRouter } from "../../AppRouter.tsx";
import { useDatabaseTable } from "./DatabaseTableContext.ts";
import { RecordForm } from "./RecordForm.tsx";

export interface DatabaseRecordPageProps {
  /**
   * The table the record belongs to, the parent page's own.
   */
  table: string;
  /**
   * A primary key, or `"new"` for the create form.
   */
  recordId: string;
}

/**
 * One record of the open table, beside its grid.
 *
 * A child of the table page (#Q2351), so it reads the row out of the page of
 * rows the grid already holds, and saving or deleting goes through the grid,
 * which reloads itself. Closing returns to the table with its page, sort and
 * search intact.
 */
const DatabaseRecordPage = (props: DatabaseRecordPageProps) => {
  const router = useRouter<AppRouter>();
  const grid = useDatabaseTable();
  const isNew = props.recordId === "new";

  const record = useMemo(() => {
    if (isNew) return null;
    return (
      grid.records.find((r) => String(r[grid.pk]) === props.recordId) ?? null
    );
  }, [grid.records, grid.pk, props.recordId, isNew]);

  if ((!record && !isNew) || !grid.entity) return null;

  return (
    <RecordForm
      entity={grid.entity}
      record={record}
      isNew={isNew}
      pkColumn={grid.pk}
      onSave={(values) =>
        isNew
          ? grid.write("POST", values)
          : grid.write("PUT", values, String(record?.[grid.pk]))
      }
      onDuplicate={async (values) => {
        await grid.write("POST", values);
      }}
      onDelete={() => record && grid.removeIds([String(record[grid.pk])])}
      onClose={() =>
        router.push("rowsTable", {
          params: { table: props.table },
          query: router.query,
        })
      }
    />
  );
};

export default DatabaseRecordPage;
