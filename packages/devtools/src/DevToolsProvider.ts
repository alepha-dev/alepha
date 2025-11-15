import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $batch } from "@alepha/batch";
import { $hook, $inject, Alepha, pageQuerySchema, t } from "@alepha/core";
import {
  $logger,
  JsonFormatterProvider,
  type LogEntry,
  logEntrySchema,
} from "@alepha/logger";
import { parseQueryString } from "@alepha/orm";
import { $route, ServerProvider } from "@alepha/server";
import { $serve } from "@alepha/server-static";
import { type DevLogEntry, logs } from "./entities/logs.ts";
import { DevToolsMetadataProvider } from "./providers/DevToolsMetadataProvider.ts";
import { LogRepository } from "./repositories/LogRepository.ts";
import { devMetadataSchema } from "./schemas/DevMetadata.ts";

export class DevToolsProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly jsonFormatter = $inject(JsonFormatterProvider);
  protected readonly logs = $inject(LogRepository);
  protected readonly devCollectorProvider = $inject(DevToolsMetadataProvider);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.log.info(
        `Devtools available at ${this.serverProvider.hostname}/devtools/`,
      );
    },
  });

  protected batchLogs = $batch({
    maxSize: 50,
    maxDuration: [10, "seconds"],
    schema: logs.insertSchema,
    handler: async (entries) => {
      await this.logs.createMany(entries);
    },
  });

  protected readonly onLog = $hook({
    on: "log",
    handler: async (ev: { message?: string; entry: LogEntry }) => {
      // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      // CAUTION: It's very easy to create an infinite loop here.
      // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

      try {
        if (!this.alepha.isStarted()) {
          return;
        }

        if (ev.entry.module === "alepha.devtools") {
          // skip devtools logs to avoid infinite loop
          return;
        }

        if (ev.entry.level === "TRACE" && ev.entry.module === "alepha.batch") {
          // skip batch trace logs to avoid infinite loop
          return;
        }

        if (this.alepha.isProduction() && ev.entry.level === "TRACE") {
          // skip trace logs in production
          return;
        }

        const entry = {
          ...ev.entry,
          data:
            ev.entry.data instanceof Error
              ? this.jsonFormatter.formatJsonError(ev.entry.data)
              : typeof ev.entry.data === "object" &&
                  !Array.isArray(ev.entry.data)
                ? ev.entry.data
                : { data: ev.entry.data },
        };

        await this.batchLogs.push(entry as DevLogEntry);
      } catch (error) {
        // DO TO NOT WITH THE LOGGER HERE TO AVOID INFINITE LOOP
        console.error(error, ev);
      }
    },
  });

  protected readonly uiRoute = $serve({
    path: "/devtools",
    root: join(fileURLToPath(import.meta.url), "../../assets/devtools"),
    historyApiFallback: true,
  });

  protected readonly metadataRoute = $route({
    method: "GET",
    path: "/devtools/api/metadata",
    silent: true,
    schema: {
      response: devMetadataSchema,
    },
    handler: () => {
      return this.devCollectorProvider.getMetadata();
    },
  });

  protected readonly logsRoute = $route({
    method: "GET",
    path: "/devtools/api/logs",
    silent: true,
    schema: {
      query: t.extend(pageQuerySchema, {
        search: t.optional(t.string()),
      }),
      response: t.page(logEntrySchema),
    },
    handler: ({ query }) => {
      query.sort ??= "-timestamp";
      return this.logs.paginate(
        query,
        query.search
          ? {
              where: parseQueryString(query.search),
            }
          : {},
        {
          count: true,
        },
      );
    },
  });
}
