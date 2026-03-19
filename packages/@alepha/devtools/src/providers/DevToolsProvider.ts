import { $hook, $inject, Alepha, t } from "alepha";
import { $logger, MemoryDestinationProvider } from "alepha/logger";
import { RepositoryProvider } from "alepha/orm";
import { $route, ServerProvider } from "alepha/server";
import { $serve } from "alepha/server/static";
import { devtoolsAssets } from "../assets.ts";
import { devMetadataSchema } from "../schemas/DevMetadata.ts";
import { DevToolsMetadataProvider } from "./DevToolsMetadataProvider.ts";

export class DevToolsProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly devCollectorProvider = $inject(DevToolsMetadataProvider);
  protected readonly memoryDestination = $inject(MemoryDestinationProvider);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.log.info("Devtools OK", {
        url: `${this.serverProvider.hostname}/__devtools/`,
      });
    },
  });

  /**
   * Capture all logs into memory so the devtools UI can display them.
   * In dev mode, LogDestinationProvider is bound to ConsoleDestinationProvider,
   * so MemoryDestinationProvider would otherwise never receive writes.
   */
  protected readonly onLog = $hook({
    on: "log",
    handler: ({ entry }) => {
      this.memoryDestination.write("", entry);
    },
  });

  protected readonly uiRoute = $serve({
    path: "/__devtools",
    root: devtoolsAssets.ui,
    historyApiFallback: true,
    silent: true,
  });

  protected readonly metadataRoute = $route({
    method: "GET",
    path: "/__devtools/api/metadata",
    silent: true,
    schema: {
      response: devMetadataSchema,
    },
    handler: () => {
      return this.devCollectorProvider.getMetadata();
    },
  });

  protected readonly updateAtomRoute = $route({
    method: "POST",
    path: "/__devtools/api/atoms",
    silent: true,
    schema: {
      body: t.object({
        name: t.text(),
        value: t.any(),
      }),
      response: t.object({
        success: t.boolean(),
      }),
    },
    handler: ({ body }) => {
      const atoms = this.alepha.store.getAtoms(false);
      const atomEntry = atoms.find((a) => a.atom.key === body.name);

      if (atomEntry) {
        this.alepha.store.set(atomEntry.atom, body.value);
        return { success: true };
      }

      return { success: false };
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Logs endpoint
  // -------------------------------------------------------------------------------------------------------------------

  protected readonly logsRoute = $route({
    method: "GET",
    path: "/__devtools/api/logs",
    silent: true,
    schema: {
      query: t.object({
        level: t.optional(t.text()),
        type: t.optional(t.text()),
        module: t.optional(t.text()),
        search: t.optional(t.text()),
        since: t.optional(t.text()),
        limit: t.optional(t.text()),
        offset: t.optional(t.text()),
      }),
      response: t.object({
        logs: t.array(t.any()),
        total: t.integer(),
      }),
    },
    handler: ({ query }) => {
      const levelOrder = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];
      let entries = this.memoryDestination.logs;

      if (query.level) {
        const minIndex = levelOrder.indexOf(query.level.toUpperCase());
        if (minIndex >= 0) {
          entries = entries.filter(
            (e) => levelOrder.indexOf(e.level) >= minIndex,
          );
        }
      }

      if (query.type) {
        const types = query.type.split(",").map((t) => t.trim());
        entries = entries.filter((e) => {
          if (!e.data || typeof e.data !== "object") return false;
          const d = e.data as Record<string, unknown>;
          for (const t of types) {
            if (t === "http" || t === "http:request") {
              if (d.status && d.method && d.path && d.duration) return true;
            } else if (t === "db" || t === "db:query") {
              if (d.type === "db:query") return true;
            } else if (d.type === t) {
              return true;
            }
          }
          return false;
        });
      }

      if (query.module) {
        entries = entries.filter((e) => e.module === query.module);
      }

      if (query.search) {
        const terms = query.search.toLowerCase().split(/\s+/);
        entries = entries.filter((e) => {
          const text = `${e.message} ${e.module} ${e.service}`.toLowerCase();
          return terms.every((term) => text.includes(term));
        });
      }

      if (query.since) {
        const since = Number(query.since);
        if (!Number.isNaN(since)) {
          entries = entries.filter((e) => e.timestamp >= since);
        }
      }

      const total = entries.length;

      // Reverse so newest first
      entries = entries.reverse();

      const offset = query.offset ? Number(query.offset) : 0;
      const limit = query.limit ? Number(query.limit) : 100;
      entries = entries.slice(offset, offset + limit);

      return { logs: entries, total };
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // DB CRUD endpoints
  // -------------------------------------------------------------------------------------------------------------------

  protected readonly dbListRoute = $route({
    method: "GET",
    path: "/__devtools/api/db/:entity/records",
    silent: true,
    schema: {
      params: t.object({ entity: t.text() }),
      query: t.object({
        page: t.optional(t.text()),
        size: t.optional(t.text()),
        sort: t.optional(t.text()),
      }),
      response: t.record(t.text(), t.any()),
    },
    handler: async ({ params, query }) => {
      const repo = this.getRepository(params.entity);
      if (!repo) {
        return { content: [], page: { totalElements: 0 } };
      }

      return repo.paginate(
        {
          page: query.page ? Number(query.page) : 0,
          size: query.size ? Number(query.size) : 50,
          sort: query.sort || undefined,
        },
        {},
        { count: true },
      ) as any;
    },
  });

  protected readonly dbCreateRoute = $route({
    method: "POST",
    path: "/__devtools/api/db/:entity/records",
    silent: true,
    schema: {
      params: t.object({ entity: t.text() }),
      body: t.record(t.text(), t.any()),
      response: t.record(t.text(), t.any()),
    },
    handler: async ({ params, body }) => {
      const repo = this.getRepository(params.entity);
      if (!repo) {
        return { error: "Entity not found" };
      }
      return repo.create(body) as any;
    },
  });

  protected readonly dbUpdateRoute = $route({
    method: "PUT",
    path: "/__devtools/api/db/:entity/records/:id",
    silent: true,
    schema: {
      params: t.object({ entity: t.text(), id: t.text() }),
      body: t.record(t.text(), t.any()),
      response: t.record(t.text(), t.any()),
    },
    handler: async ({ params, body }) => {
      const repo = this.getRepository(params.entity);
      if (!repo) {
        return { error: "Entity not found" };
      }

      const idValue = this.parseId(repo, params.id);
      return repo.updateById(idValue, body) as any;
    },
  });

  protected readonly dbDeleteRoute = $route({
    method: "DELETE",
    path: "/__devtools/api/db/:entity/records/:id",
    silent: true,
    schema: {
      params: t.object({ entity: t.text(), id: t.text() }),
      response: t.record(t.text(), t.any()),
    },
    handler: async ({ params }) => {
      const repo = this.getRepository(params.entity);
      if (!repo) {
        return { error: "Entity not found" };
      }

      const idValue = this.parseId(repo, params.id);
      return repo.deleteById(idValue) as any;
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  protected getRepository(entityName: string) {
    try {
      const repositoryProvider = this.alepha.inject(RepositoryProvider);
      const repos = repositoryProvider.getRepositories();
      return repos.find((r) => r.entity.name === entityName);
    } catch {
      return undefined;
    }
  }

  protected parseId(repo: any, rawId: string): string | number {
    const idType = repo.id.type;
    if (idType?.type === "integer" || idType?.type === "number") {
      return Number(rawId);
    }
    return rawId;
  }
}
