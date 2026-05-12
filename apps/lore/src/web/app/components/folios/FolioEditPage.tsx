import { useStore } from "alepha/react";
import { currentFolioAtom } from "../../atoms/currentFolioAtom.ts";
import FolioEditor from "./FolioEditor.tsx";

const FolioEditPage = () => {
  const [folio] = useStore(currentFolioAtom);
  if (!folio) return null;
  return <FolioEditor folio={folio} />;
};

export default FolioEditPage;
