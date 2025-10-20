import { Alepha } from "@alepha/core";
import {
  LogDestinationProvider,
  type LogEntry,
  MemoryDestinationProvider,
} from "@alepha/logger";
import { $action, ServerProvider } from "@alepha/server";
import { describe, expect, it } from "vitest";
import { $client, $remote, AlephaServerLinks } from "../src";

describe("requestId", () => {
  it("should propagate requestId across multiple remote service calls", async () => {
    class Puppeteer {
      print = $action({
        handler: () => {
          return "Puppeteer is not available in this environment.";
        },
      });
    }

    const entries = [] as Array<LogEntry & { formatted: string }>;

    class SharedMemoryDestinationProvider extends MemoryDestinationProvider {
      entries = entries;

      clear() {
        this.entries.splice(0, this.entries.length);
      }
    }

    const p1 = Alepha.create({
      env: {
        APP_NAME: "PPT",
        LOG_LEVEL: "info",
      },
    })
      .with({
        provide: LogDestinationProvider,
        use: SharedMemoryDestinationProvider,
      })
      .with(Puppeteer)
      .with(AlephaServerLinks);

    const output = p1.inject(SharedMemoryDestinationProvider);

    class Reporting {
      puppeteer = $remote({
        url: () => p1.inject(ServerProvider).hostname,
      });

      puppeteerApi = $client<Puppeteer>();

      exportPdf = $action({
        handler: () => {
          return this.puppeteerApi.print();
        },
      });
    }

    const p2 = Alepha.create({
      env: {
        APP_NAME: "RPM",
        LOG_LEVEL: "info",
      },
    })
      .with({
        provide: LogDestinationProvider,
        use: SharedMemoryDestinationProvider,
      })
      .with(Reporting);

    class Frontend {
      reporting = $remote({
        url: () => p2.inject(ServerProvider).hostname,
      });

      reportingApi = $client<Reporting>();

      download = $action({
        handler: () => {
          return this.reportingApi.exportPdf();
        },
      });
    }

    const p3 = Alepha.create({
      env: {
        APP_NAME: "ADM",
        LOG_LEVEL: "info",
      },
    })
      .with({
        provide: LogDestinationProvider,
        use: SharedMemoryDestinationProvider,
      })
      .with(Frontend);

    await p1.start();
    await p2.start();
    await p3.start();

    output.clear();

    await fetch(`${p3.inject(ServerProvider).hostname}/api/download`);

    const uuid = output.logs[0].context;
    const logs = output.logs.map(
      (it) => `${it.app} - ${it.message} - ${it.context}`,
    );

    expect(logs).toEqual([
      `ADM - Incoming request - ${uuid}`,
      `RPM - Incoming request - ${uuid}`,
      `PPT - Incoming request - ${uuid}`,
      `PPT - Request completed - ${uuid}`,
      `RPM - Request completed - ${uuid}`,
      `ADM - Request completed - ${uuid}`,
    ]);
  });
});
