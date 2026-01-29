
# Alepha Logs

3 modules across different locations:

## `alepha/api/logs` - AlephaApiLogs (Server)

Module for handling logs collected from various sources.

- 1-2 days retention policy for logs (configurable)
- Independent SQLite storage for logs with querying capabilities
- Output can be sent to Postgres (TimescaleDB) if big data storage is needed

## `alepha/api/logs-client` - AlephaApiLogsClient (Client)

Client module for interacting with AlephaApiLogs automatically.

- Uses Alepha micro-services features to collect logs from different services
- Keyless Codec, Batching, ...

## `@alepha/ui/logs` - AlephaUiLogs (UI)

UI components for displaying and managing logs within the Alepha framework.

- Devtools UI for log visualization and querying

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
