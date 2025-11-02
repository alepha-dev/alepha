import { t } from "@alepha/core";
import { type LogEntry, logEntrySchema } from "@alepha/logger";
import { useAction, useInject } from "@alepha/react";
import { HttpClient } from "@alepha/server";
import { useState } from "react";

const DevLogs = () => {
  const http = useInject(HttpClient);
  const [logs, setLog] = useState<LogEntry[]>([]);
  useAction(
    {
      runOnInit: true,
      runEvery: [10, "seconds"],
      handler: async () => {
        setLog(
          await http
            .fetch("/devtools/api/logs", {
              schema: {
                response: t.array(logEntrySchema),
              },
            })
            .then(({ data }) => data),
        );
      },
    },
    [],
  );

  return (
    <div>
      <pre>{JSON.stringify(logs, null, "  ")}</pre>
    </div>
  );
};

export default DevLogs;
