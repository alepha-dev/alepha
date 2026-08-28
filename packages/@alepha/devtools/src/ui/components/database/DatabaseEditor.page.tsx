import { useMetadata } from "../../hooks/useMetadata.ts";
import { DatabaseEditor } from "./DatabaseEditor.tsx";

export interface DatabaseEditorPageProps {
  /**
   * Which table is open, `""` on `/rows` itself. Supplied by each of the
   * three routes' loaders rather than parsed out of the pathname here.
   */
  table: string;
  /**
   * Which record is open: a primary key, `"new"` for the create form, or `""`
   * when only the table is open.
   */
  recordId: string;
}

const DatabaseEditorPage = (props: DatabaseEditorPageProps) => {
  const meta = useMetadata();
  return (
    <DatabaseEditor
      entities={meta.data?.entities ?? []}
      table={props.table}
      recordId={props.recordId}
    />
  );
};

export default DatabaseEditorPage;
