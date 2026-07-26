import { useMetadata } from "../../hooks/useMetadata.ts";
import { DevError } from "../shared/DevError.tsx";
import { DatabaseErd } from "./DatabaseErd.tsx";

const DatabaseErdPage = () => {
  const meta = useMetadata();

  if (meta.error) {
    return (
      <DevError what="schema" message={meta.error} onRetry={meta.reload} />
    );
  }

  return <DatabaseErd entities={meta.data?.entities ?? []} />;
};

export default DatabaseErdPage;
