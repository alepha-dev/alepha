import FolioEditor from "./FolioEditor.tsx";

const FolioCreatePage = (props?: { directoryId?: string }) => (
  // The Folio route loader passes `directoryId` when navigation
  // came from "+ Create → New folio" inside a directory; without it
  // the editor creates the folio at the project root.
  <FolioEditor directoryId={props?.directoryId} />
);

export default FolioCreatePage;
