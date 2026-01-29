



2 modules:

AlephaApiLogs - Module for handling logs collected from various sources.

- 1-2 days retention policy for logs. (more can be configured)
- Independent Sqlite storage for logs with querying capabilities.
- Output can be sent to Postgres (TimeScaleDB) if big data storage is needed.

AlephaApiLogsClient - Client module for interacting with the AlephaApiLogs module automatically.

- use Alepha micro-services features to collect logs from different services.
- Keyless Codec, Batching, ...

1 external module: (@alepha/ui)

- UI of current devtools

AlephaApiLogsUI - UI components for displaying and managing logs within the Alepha framework.

--- CLIENT ----

class LogCollectorClient {
  collector = $remote({
    url: "http://localhost:5000/",
  });

  client = $client<LogController>();

  batchLog = $batch({
    maxDuration: [10, "seconds"],
    maxItems: 50,
    handler: (logs: Logs[]) => {
      return this.client.collect({ body: logs });
    }
  })

  onLog = $hook({
    on: "log",
    handler: (log) => {
      if (log.level === "trace") return;
      return this.batchLog.push(log);
    }
  })
}

const $collector = (opts: {url}) => $context().alepha.with(LogCollectorClient).set(logCollectorOptions, {url})

---- SERVER ----
