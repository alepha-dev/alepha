import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $batch } from "@alepha/batch";
import { $bucket } from "@alepha/bucket";
import { $cache } from "@alepha/cache";
import { $hook, $inject, Alepha, pageQuerySchema, t } from "@alepha/core";
import { $logger, type LogEntry, logEntrySchema } from "@alepha/logger";
import {
  $entity,
  $repository,
  NodeSqliteProvider,
  parseQueryString,
  pg,
} from "@alepha/postgres";
import { $queue } from "@alepha/queue";
import { $scheduler } from "@alepha/scheduler";
import { $realm } from "@alepha/security";
import { $action, $route, ServerProvider } from "@alepha/server";
import { $serve } from "@alepha/server-static";
import { $topic } from "@alepha/topic";
import type { DevActionMetadata } from "./schemas/DevActionMetadata.ts";
import type { DevBucketMetadata } from "./schemas/DevBucketMetadata.ts";
import type { DevCacheMetadata } from "./schemas/DevCacheMetadata.ts";
import { type DevMetadata, devMetadataSchema } from "./schemas/DevMetadata.ts";
import type { DevModuleMetadata } from "./schemas/DevModuleMetadata.ts";
import type { DevPageMetadata } from "./schemas/DevPageMetadata.ts";
import type { DevProviderMetadata } from "./schemas/DevProviderMetadata.ts";
import type { DevQueueMetadata } from "./schemas/DevQueueMetadata.ts";
import type { DevRealmMetadata } from "./schemas/DevRealmMetadata.ts";
import type { DevSchedulerMetadata } from "./schemas/DevSchedulerMetadata.ts";
import type { DevTopicMetadata } from "./schemas/DevTopicMetadata.ts";

class DevToolsDatabaseProvider extends NodeSqliteProvider {
  get name() {
    return "devtools";
  }
  options = {
    path: ":memory:",
  };
}

const logs = $entity({
  name: "logs",
  schema: t.object({
    id: pg.primaryKey(),
    level: t.enum(["SILENT", "TRACE", "DEBUG", "INFO", "WARN", "ERROR"]),
    message: t.text({
      size: "rich",
    }),
    service: t.text(),
    module: t.text(),
    context: t.optional(t.text()),
    app: t.optional(t.text()),
    data: t.optional(t.json()),
    timestamp: t.datetime(),
  }),
});

export class DevCollectorProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly sqliteProvider = $inject(DevToolsDatabaseProvider);
  protected readonly log = $logger();

  logs = $repository({
    entity: logs,
    provider: this.sqliteProvider,
  });

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
    schema: logEntrySchema,
    handler: async (entries: LogEntry[]) => {
      await this.logs.createMany(entries);
    },
  });

  protected readonly onLog = $hook({
    on: "log",
    handler: async (ev: { message?: string; entry: LogEntry }) => {
      if (!this.alepha.isReady()) {
        return;
      }

      if (ev.entry.level === "TRACE" && ev.entry.module === "alepha.batch") {
        // skip batch trace logs to avoid infinite loop
        return;
      }

      await this.batchLogs.push(ev.entry);
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
      return this.getMetadata();
    },
  });

  protected readonly logsRoute = $route({
    method: "GET",
    path: "/devtools/api/logs",
    silent: true,
    schema: {
      query: t.interface([pageQuerySchema], {
        search: t.optional(t.string()),
      }),
      response: t.page(logEntrySchema),
    },
    handler: ({ query }) => {
      query.sort ??= "-timestamp";
      if (query.search) {
        console.log(parseQueryString(query.search));
      }
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

  // -------------------------------------------------------------------------------------------------------------------

  public getActions(): DevActionMetadata[] {
    const actionDescriptors = this.alepha.descriptors($action);

    return actionDescriptors.map((action) => {
      const schema = action.schema;
      const options = action.options as any; // Allow accessing augmented properties

      return {
        name: action.name,
        group: action.group,
        method: action.method,
        path: action.path,
        prefix: action.prefix,
        fullPath: action.route.path,
        description: action.options.description,
        summary: options.summary,
        disabled: action.options.disabled,
        secure: options.secure,
        hide: options.hide,
        body: schema?.body,
        params: schema?.params,
        query: schema?.query,
        response: schema?.response,
        bodyContentType: action.getBodyContentType(),
      };
    });
  }

  public getQueues(): DevQueueMetadata[] {
    const queueDescriptors = this.alepha.descriptors($queue);

    return queueDescriptors.map((queue) => ({
      name: queue.name,
      description: queue.options.description,
      schema: queue.options.schema,
      provider: this.getProviderName(queue.options.provider),
    }));
  }

  public getSchedulers(): DevSchedulerMetadata[] {
    const schedulerDescriptors = this.alepha.descriptors($scheduler);

    return schedulerDescriptors.map((scheduler) => ({
      name: scheduler.name,
      description: scheduler.options.description,
      cron: scheduler.options.cron,
      interval: scheduler.options.interval,
      lock: scheduler.options.lock,
    }));
  }

  public getTopics(): DevTopicMetadata[] {
    const topicDescriptors = this.alepha.descriptors($topic);

    return topicDescriptors.map((topic) => ({
      name: topic.name,
      description: topic.options.description,
      schema: topic.options.schema,
      provider: this.getProviderName(topic.options.provider),
    }));
  }

  public getBuckets(): DevBucketMetadata[] {
    const bucketDescriptors = this.alepha.descriptors($bucket);

    return bucketDescriptors.map((bucket) => ({
      name: bucket.name,
      description: bucket.options.description,
      mimeTypes: bucket.options.mimeTypes,
      maxSize: bucket.options.maxSize,
      provider: this.getProviderName(bucket.options.provider),
    }));
  }

  public getRealms(): DevRealmMetadata[] {
    const realmDescriptors = this.alepha.descriptors($realm);

    return realmDescriptors.map((realm) => ({
      name: realm.name,
      description: realm.options.description,
      roles: realm.options.roles,
      type: "secret" in realm.options ? "internal" : "external",
      settings: {
        accessTokenExpiration: realm.options.settings?.accessToken?.expiration,
        refreshTokenExpiration:
          realm.options.settings?.refreshToken?.expiration,
        hasOnCreateSession: !!realm.options.settings?.onCreateSession,
        hasOnRefreshSession: !!realm.options.settings?.onRefreshSession,
        hasOnDeleteSession: !!realm.options.settings?.onDeleteSession,
      },
    }));
  }

  public getCaches(): DevCacheMetadata[] {
    const cacheDescriptors = this.alepha.descriptors($cache);

    return cacheDescriptors.map((cache) => ({
      name: cache.container,
      ttl: cache.options.ttl,
      disabled: cache.options.disabled,
      provider: this.getProviderName(cache.options.provider),
    }));
  }

  public getPages(): DevPageMetadata[] {
    // const pageDescriptors = this.alepha.descriptors($page);
    //
    // return pageDescriptors.map((page) => ({
    //   name: page.name,
    //   description: page.options.description,
    //   path: page.options.path,
    //   params: page.options.schema?.params,
    //   query: page.options.schema?.query,
    //   hasComponent: !!page.options.component,
    //   hasLazy: !!page.options.lazy,
    //   hasResolve: !!page.options.resolve,
    //   hasChildren: !!page.options.children,
    //   hasParent: !!page.options.parent,
    //   hasErrorHandler: !!page.options.errorHandler,
    //   static:
    //     typeof page.options.static === "boolean"
    //       ? page.options.static
    //       : !!page.options.static,
    //   cache: page.options.cache,
    //   client: page.options.client,
    //   animation: page.options.animation,
    // }));

    return [];
  }

  public getProviders(): DevProviderMetadata[] {
    const graph = this.alepha.graph();

    return Object.entries(graph).map(([name, info]) => ({
      name,
      module: info.module,
      dependencies: info.from,
      aliases: info.as,
    }));
  }

  public getModules(): DevModuleMetadata[] {
    const graph = this.alepha.graph();
    const moduleMap = new Map<string, Set<string>>();

    // Group providers by module
    for (const [providerName, info] of Object.entries(graph)) {
      if (info.module) {
        if (!moduleMap.has(info.module)) {
          moduleMap.set(info.module, new Set());
        }
        moduleMap.get(info.module)!.add(providerName);
      }
    }

    return Array.from(moduleMap.entries()).map(([name, providers]) => ({
      name,
      providers: Array.from(providers),
    }));
  }

  public getMetadata(): DevMetadata {
    return {
      actions: this.getActions(),
      queues: this.getQueues(),
      schedulers: this.getSchedulers(),
      topics: this.getTopics(),
      buckets: this.getBuckets(),
      realms: this.getRealms(),
      caches: this.getCaches(),
      pages: this.getPages(),
      providers: this.getProviders(),
      modules: this.getModules(),
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected getProviderName(provider?: "memory" | any): string {
    if (!provider) {
      return "default";
    }
    if (provider === "memory") {
      return "memory";
    }
    return provider.name || "custom";
  }
}
