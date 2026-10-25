import { useMetadata } from "../../hooks/useMetadata.ts";
import { DevError } from "../shared/DevError.tsx";
import { DatabaseErd } from "./DatabaseErd.tsx";
import { MigrationDrift } from "./MigrationDrift.tsx";

const DatabaseErdPage = () => {
  const meta = useMetadata();

  if (meta.error) {
    return (
      <DevError what="schema" message={meta.error} onRetry={meta.reload} />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <MigrationDrift />
      <DatabaseErd entities={meta.data?.entities ?? []} />
    </div>
  );
};

export default DatabaseErdPage;
