import FolioWorkspace from "./editor/FolioWorkspace.tsx";
import FolioTableCreate from "./editor/table/FolioTableCreate.tsx";

export interface FolioCreatePageProps {
  /**
   * The Folio route loader passes `directoryId` when navigation came from
   * "+ Create → New folio" inside a directory; without it the workspace
   * creates the folio at the project root.
   */
  directoryId?: string;
  /**
   * `table` (from `?type=table`) creates a table folio; anything else the
   * Markdown workspace's create mode (#E144).
   */
  type?: "table";
}

const FolioCreatePage = (props: FolioCreatePageProps) =>
  props.type === "table" ? (
    <FolioTableCreate directoryId={props.directoryId} />
  ) : (
    <FolioWorkspace directoryId={props.directoryId} />
  );

export default FolioCreatePage;
