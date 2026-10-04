import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useCallback, useEffect, useState } from "react";

import type { MigrationDrift as Drift } from "../../../server/schemas/migrationDriftSchema.ts";
import { useRunId } from "../../hooks/useRunId.ts";

/**
 * Migration files of the selected app that differ from the default branch:
 * added or modified since the merge-base, uncommitted ones included. The
 * thing to review before a merge, and the usual cause of "works on my branch".
 * Nothing shows when nothing differs, or when there is no remote to compare
 * with.
 */
export const MigrationDrift = () => {
  const http = useInject(HttpClient);
  const runId = useRunId();
  const [drift, setDrift] = useState<(Drift & { pending?: boolean }) | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await http.fetch(
        `/apps/${encodeURIComponent(runId)}/migrations`,
      );
      setDrift(res.data as Drift & { pending?: boolean });
    } catch {
      setDrift(null);
    }
  }, [http, runId]);

  useEffect(() => {
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
    // The server refreshes git state on its own interval; reading it again
    // now and then is enough to follow a commit or a new file.
    const id = setInterval(load, drift?.pending ? 2000 : 15_000);
    return () => clearInterval(id);
  }, [load, drift?.pending]);

  if (!drift || drift.files.length === 0) return null;

  return (
    <div className="dt-banner" style={{ margin: "10px 14px 0" }}>
      <div>
        {drift.files.length} migration file
        {drift.files.length === 1 ? "" : "s"} differ
        {drift.files.length === 1 ? "s" : ""} from {drift.base}:
      </div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }} className="dt-mono">
        {drift.files.map((file) => (
          <li key={file.path}>
            {file.path} ({file.status})
          </li>
        ))}
      </ul>
    </div>
  );
};
