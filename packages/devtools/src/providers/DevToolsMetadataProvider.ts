import { $bucket } from "@alepha/bucket";
import { $cache } from "@alepha/cache";
import { $inject, Alepha } from "alepha";
import { $logger } from "@alepha/logger";
import { $queue } from "@alepha/queue";
import { $scheduler } from "@alepha/scheduler";
import { $realm } from "@alepha/security";
import { $action } from "@alepha/server";
import { $topic } from "@alepha/topic";
import type { DevActionMetadata } from "../schemas/DevActionMetadata.ts";
import type { DevBucketMetadata } from "../schemas/DevBucketMetadata.ts";
import type { DevCacheMetadata } from "../schemas/DevCacheMetadata.ts";
import type { DevMetadata } from "../schemas/DevMetadata.ts";
import type { DevModuleMetadata } from "../schemas/DevModuleMetadata.ts";
import type { DevPageMetadata } from "../schemas/DevPageMetadata.ts";
import type { DevProviderMetadata } from "../schemas/DevProviderMetadata.ts";
import type { DevQueueMetadata } from "../schemas/DevQueueMetadata.ts";
import type { DevRealmMetadata } from "../schemas/DevRealmMetadata.ts";
import type { DevSchedulerMetadata } from "../schemas/DevSchedulerMetadata.ts";
import type { DevTopicMetadata } from "../schemas/DevTopicMetadata.ts";

export class DevToolsMetadataProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();

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
