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
   * `table` or `calendar` (from `?type=`) creates a folio of rows; anything
   * else the Markdown workspace's create mode (#E144, #Q3717).
   */
  type?: "table" | "calendar";
}

const FolioCreatePage = (props: FolioCreatePageProps) =>
  props.type ? (
    <FolioTableCreate directoryId={props.directoryId} type={props.type} />
  ) : (
    <FolioWorkspace directoryId={props.directoryId} />
  );

export default FolioCreatePage;
