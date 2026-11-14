import FolioWorkspace from "./editor/FolioWorkspace.tsx";

export interface FolioCreatePageProps {
  /**
   * The Folio route loader passes `directoryId` when navigation came from
   * "+ Create → New folio" inside a directory; without it the workspace
   * creates the folio at the project root.
   */
  directoryId?: string;
}

const FolioCreatePage = (props: FolioCreatePageProps) => (
  <FolioWorkspace directoryId={props.directoryId} />
);

export default FolioCreatePage;
