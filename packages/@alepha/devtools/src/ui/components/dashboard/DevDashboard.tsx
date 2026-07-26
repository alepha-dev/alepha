import { useRouter } from "alepha/react/router";
import { RotateCw } from "lucide-react";
import { useLogTail } from "../../hooks/useLogTail.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { DevError } from "../shared/DevError.tsx";
import { DevSectionHeader } from "../shared/DevSectionHeader.tsx";
import { DashboardEvents } from "./DashboardEvents.tsx";
import { DashboardLogs } from "./DashboardLogs.tsx";
import { DashboardPrimitives } from "./DashboardPrimitives.tsx";
import { DashboardSystemStrip } from "./DashboardSystemStrip.tsx";

export const DevDashboard = () => {
  const meta = useMetadata();
  const router = useRouter();
  const tail = useLogTail({
    level: "DEBUG",
    type: "",
    module: "",
    search: "",
  });

  if (meta.error) {
    return (
      <DevError what="metadata" message={meta.error} onRetry={meta.reload} />
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
      <DevSectionHeader
        label="System"
        action={
          <button type="button" className="dt-btn" onClick={meta.reload}>
            <RotateCw size={11} /> Reload
          </button>
        }
      />
      <DashboardSystemStrip system={meta.data?.system} />

      {/*
       * Events and logs sit side by side because they answer different halves
       * of the same question: events are what the app is doing right now, logs
       * are what it said about it.
       */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 14,
          marginBottom: 22,
        }}
      >
        <DashboardEvents entries={tail.entries} />
        <DashboardLogs
          entries={tail.entries}
          onViewAll={() => router.push("/logs")}
        />
      </div>

      <DevSectionHeader label="Primitives" />
      <DashboardPrimitives metadata={meta.data} />
    </div>
  );
};

export default DevDashboard;
