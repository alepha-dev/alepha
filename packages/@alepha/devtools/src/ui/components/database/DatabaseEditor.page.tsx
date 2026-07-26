import { useMetadata } from "../../hooks/useMetadata.ts";
import { DatabaseEditor } from "./DatabaseEditor.tsx";

const DatabaseEditorPage = () => {
  const meta = useMetadata();
  return <DatabaseEditor entities={meta.data?.entities ?? []} />;
};

export default DatabaseEditorPage;
