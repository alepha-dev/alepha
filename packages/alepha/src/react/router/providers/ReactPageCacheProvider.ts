import {
  $atom,
  $env,
  $hook,
  $inject,
  $store,
  Alepha,
  AlephaError,
  type Infer,
  type ReadVerdict,
  z,
} from "alepha";
import { CacheProvider, MemoryCacheProvider } from "alepha/cache";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $action } from "alepha/server";

import type {
  PageInvalidation,
  PageInvalidationEvent,
} from "../primitives/$page.ts";
import { type PageRoute, ReactPageProvider } from "./ReactPageProvider.ts";

/**
 * The automatic page cache (#E78).
 *
 * Every server-rendered page whose render read nothing personal (see
 * `ReadRecorder`) is cached, with no option: its shared bytes, everything but
 * the private hydration script, are kept under
 * `page:<build>:<name>:<params>:<query>:<lang>`. A later request for the same
 * key, signed in or not, gets those bytes followed by a private script built
 * for it, without running a loader or React.
 *
 * - Lifetime: a page with no loader anywhere in its layer chain lives until
 *   the next deploy (the build is in the key); a page with a loader, 60 s.
 *   `$page({ cache: { ttl } })` overrides, `$page({ cache: false })` opts out.
 * - Storage: the app's `CacheProvider`, so with Redis an entry and its
 *   invalidation span instances. The in-memory provider is replaced by a
 *   bounded LRU here (it has no size limit of its own), and so is the workerd
 *   default, whose edge tier is `caches.default`, not KV.
 * - Kill switch: `REACT_PAGE_CACHE=false`, or the `enabled` option.
 */
export class ReactPageCacheProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly env = $env(envSchema);
  protected readonly options = $store(reactPageCacheOptions);

  /**
   * The cache container every page entry lives in.
   */
  public static readonly CONTAINER = "alepha.react.page";

  /**
   * Default lifetime of a page with a loader in its chain.
   */
  public static readonly LOADER_TTL: DurationLike = [60, "seconds"];

  /**
   * Lifetime given to a remote provider for an entry that lives "until the
   * next deploy": the old build's keys then age out instead of living forever.
   */
  public static readonly DEPLOY_TTL: DurationLike = [7, "days"];

  /**
   * In-process LRU, used when the app's provider is the in-memory one.
   */
  protected readonly local = new Map<string, LocalEntry>();

  /**
   * The id of the code that renders, drawn once per container when nothing
   * built it (`alepha dev`, vitest), since the meta does not change between
   * reloads there.
   */
  protected devBuildId?: string;

  public get enabled(): boolean {
    return this.env.REACT_PAGE_CACHE !== false && this.options.enabled;
  }

  /**
   * Whether a page about to be cached is first rendered again as nobody, to
   * catch personal data that reached the markup without a tracked read
   * (#E78). Development and tests only: it doubles the cost of a miss.
   */
  public get anonymousCheck(): boolean {
    return this.options.anonymousCheck && !this.alepha.isProduction();
  }

  /**
   * The raw state key marking the anonymous re-render's fork: the cache is
   * off inside it.
   */
  public static readonly CHECK_KEY = "alepha.react.page.check";

  /**
   * Keys whose last write the anonymous check refused, reported as
   * `refused` by the development header until a write succeeds.
   */
  public readonly refused = new Set<string>();

  /**
   * The build segment of every key: a deploy misses every entry the previous
   * code rendered, with no purge.
   */
  public buildId(): string {
    const meta = this.alepha.meta;
    if (meta.build.dev || !meta.build.date) {
      this.devBuildId ??= `dev-${crypto.randomUUID()}`;
      return this.devBuildId;
    }
    return meta.commit ? `${meta.build.date}-${meta.commit}` : meta.build.date;
  }

  /**
   * The key prefix of one page, or of one page's params: what an invalidation
   * purges. `params`, when given, must be the page's full param set.
   */
  public prefix(route: PageRoute, params?: Record<string, unknown>): string {
    const head = `page:${this.segment(this.buildId())}:${this.segment(route.name)}:`;
    if (!params) {
      return head;
    }
    return `${head}${this.segment(this.paramsSegment(params))}:`;
  }

  /**
   * The full key of one rendered page.
   */
  public key(
    route: PageRoute,
    params: Record<string, unknown>,
    query: Record<string, unknown>,
    lang: string | undefined,
  ): string {
    const declared = this.declaredQuery(route);
    const kept = Object.keys(query)
      .filter((name) => declared.has(name) && query[name] !== undefined)
      .sort()
      .map((name) => `${name}=${this.stringify(query[name])}`)
      .join("&");
    return (
      this.prefix(route, params) +
      `${this.segment(kept || "-")}:${this.segment(lang || "-")}`
    );
  }

  /**
   * Decide what the cache does with a request for `route`: nothing (off, or
   * the page opted out), bypass (the request carries a query parameter the
   * page does not declare), or a key and a lifetime.
   */
  public plan(
    route: PageRoute,
    request: {
      params: Record<string, unknown>;
      query: Record<string, unknown>;
      url: URL;
    },
  ): PageCachePlan | undefined {
    if (
      !this.enabled ||
      route.cache === false ||
      this.alepha.context.get(ReactPageCacheProvider.CHECK_KEY)
    ) {
      return undefined;
    }

    const declared = this.declaredQuery(route);
    for (const name of request.url.searchParams.keys()) {
      if (!declared.has(name)) {
        return { bypass: `undeclared query parameter "${name}"` };
      }
    }

    return {
      key: this.key(route, request.params, request.query, this.lang()),
      ttlMs: this.ttlMs(route),
    };
  }

  public async read(key: string): Promise<PageCacheEntry | undefined> {
    const provider = this.remote();
    if (!provider) {
      const hit = this.local.get(key);
      if (!hit) {
        return undefined;
      }
      if (hit.expiresAt && hit.expiresAt <= this.dateTime.nowMillis()) {
        this.local.delete(key);
        return undefined;
      }
      // Least recently used goes first: a read moves the entry to the end.
      this.local.delete(key);
      this.local.set(key, hit);
      return hit.entry;
    }

    try {
      return await provider.getTyped<PageCacheEntry>(
        ReactPageCacheProvider.CONTAINER,
        key,
      );
    } catch (error) {
      this.log.warn("Page cache read failed, rendering", { key, error });
      return undefined;
    }
  }

  public async write(
    key: string,
    entry: PageCacheEntry,
    ttlMs: number,
  ): Promise<void> {
    const provider = this.remote();
    if (!provider) {
      this.local.delete(key);
      this.local.set(key, {
        entry,
        expiresAt: ttlMs > 0 ? this.dateTime.nowMillis() + ttlMs : 0,
      });
      while (this.local.size > this.options.max) {
        const oldest = this.local.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        this.local.delete(oldest);
      }
      return;
    }

    const ttl =
      ttlMs > 0
        ? ttlMs
        : this.dateTime
            .duration(ReactPageCacheProvider.DEPLOY_TTL)
            .as("milliseconds");
    await provider.setTyped(ReactPageCacheProvider.CONTAINER, key, entry, {
      ttl,
    });
  }

  /**
   * Remove every entry whose key starts with `prefix` (see {@link prefix}).
   */
  public async invalidate(prefix: string): Promise<void> {
    const provider = this.remote();
    if (!provider) {
      for (const key of this.local.keys()) {
        if (key.startsWith(prefix)) {
          this.local.delete(key);
        }
      }
      return;
    }
    await provider.invalidateKeys(ReactPageCacheProvider.CONTAINER, [
      `${prefix}*`,
    ]);
  }

  /**
   * Purge one page, or one page's params, in the current build: every query
   * and every language. `params`, when given, must be the page's full param
   * set, since a prefix purge cannot skip a segment; a partial set throws
   * rather than silently purging nothing. Entries of older builds are never
   * read again and are left to expire.
   */
  public async invalidatePage(
    route: PageRoute,
    params?: Record<string, unknown>,
  ): Promise<void> {
    if (params) {
      const expected = this.paramNames(route);
      const given = Object.keys(params).filter(
        (name) => params[name] !== undefined,
      );
      const missing = expected.filter((name) => !given.includes(name));
      const unknown = given.filter((name) => !expected.includes(name));
      if (missing.length || unknown.length) {
        throw new AlephaError(
          `Cannot invalidate page "${route.name}" with params {${given.join(", ")}}: ` +
            `it takes exactly {${expected.join(", ")}}. Pass them all, or none to purge every entry of the page.`,
        );
      }
    }
    await this.invalidate(this.prefix(route, params));
    this.log.debug("Page cache invalidated", { name: route.name, params });
  }

  /**
   * The names of a page's route params, in its full matched path.
   */
  public paramNames(route: PageRoute): string[] {
    const names: string[] = [];
    for (const match of route.match.matchAll(/[:{]([A-Za-z0-9_]+)\}?/g)) {
      names.push(match[1]);
    }
    if (route.match.includes("*")) {
      names.push("*");
    }
    return names;
  }

  // ---------------------------------------------------------------------------
  // `$page({ cache: { invalidatedBy } })`
  // ---------------------------------------------------------------------------

  /**
   * An action run in process (`.run()`, a `$client` call on the server).
   */
  protected readonly onActionResponse = $hook({
    on: "action:onResponse",
    handler: async ({ action, request, response }) => {
      await this.invalidateAfter(action.name, {
        result: response,
        params: request.params ?? {},
        query: request.query ?? {},
        body: request.body,
      });
    },
  });

  /**
   * An action called over HTTP: its route handler emits no action event, so
   * the response is matched back to the action by method and path. Emitted
   * before the response leaves, so the writer reads its own write.
   */
  protected readonly onHttpResponse = $hook({
    on: "server:onResponse",
    // Before compression replaces the JSON body with a compressed stream.
    priority: "first",
    handler: async ({ request, response }) => {
      if (response.status >= 400 || this.invalidations().size === 0) {
        return;
      }
      const name = this.actionsByRoute().get(
        `${request.method} ${request.metadata?.routePath}`,
      );
      if (!name) {
        return;
      }
      let result: unknown = response.body;

      if (ArrayBuffer.isView(result)) {
        result = new TextDecoder().decode(result);
      }
      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch {
          // a non-JSON body: handed over as is
        }
      }
      await this.invalidateAfter(name, {
        result,
        params: request.params ?? {},
        query: request.query ?? {},
        body: request.body,
      });
    },
  });

  protected async invalidateAfter(
    action: string,
    event: PageInvalidationEvent,
  ): Promise<void> {
    for (const { route, params } of this.invalidations().get(action) ?? []) {
      try {
        await this.invalidatePage(route, params ? params(event) : undefined);
      } catch (error) {
        this.log.error("Page invalidation failed", {
          page: route.name,
          action,
          error,
        });
      }
    }
  }

  /**
   * Action name to the pages it invalidates, built once from every page's
   * `cache.invalidatedBy`.
   */
  protected invalidations(): Map<
    string,
    Array<{ route: PageRoute; params?: PageInvalidation["params"] }>
  > {
    if (this.invalidationMap) {
      return this.invalidationMap;
    }
    const map = new Map<
      string,
      Array<{ route: PageRoute; params?: PageInvalidation["params"] }>
    >();
    for (const route of this.alepha.inject(ReactPageProvider).getPages()) {
      const cache = route.cache;
      if (!cache) {
        continue;
      }
      for (const it of cache.invalidatedBy ?? []) {
        const name = typeof it.action === "string" ? it.action : it.action.name;
        const list = map.get(name) ?? [];
        list.push({ route, params: it.params });
        map.set(name, list);
      }
    }
    this.invalidationMap = map;
    return map;
  }

  protected invalidationMap?: Map<
    string,
    Array<{ route: PageRoute; params?: PageInvalidation["params"] }>
  >;

  /**
   * `"<METHOD> <path>"` of every `$action` route to its action name.
   */
  protected actionsByRoute(): Map<string, string> {
    if (!this.routeMap) {
      this.routeMap = new Map();
      for (const action of this.alepha.primitives($action)) {
        this.routeMap.set(`${action.method} ${action.route.path}`, action.name);
      }
    }
    return this.routeMap;
  }

  protected routeMap?: Map<string, string>;

  /**
   * How many entries the in-process tier holds. For tests and diagnostics.
   */
  public get size(): number {
    return this.local.size;
  }

  /**
   * Lifetime of a page's entries in milliseconds, 0 meaning "until the next
   * deploy".
   */
  public ttlMs(route: PageRoute): number {
    const cache = route.cache;
    if (cache && cache.ttl !== undefined) {
      return this.dateTime.duration(cache.ttl).as("milliseconds");
    }
    if (route.static) {
      return 0;
    }
    for (let it: PageRoute | undefined = route; it; it = it.parent) {
      if (it.loader) {
        return this.dateTime
          .duration(ReactPageCacheProvider.LOADER_TTL)
          .as("milliseconds");
      }
    }
    return 0;
  }

  /**
   * The provider entries go to, or `undefined` for the in-process LRU.
   */
  protected remote(): CacheProvider | undefined {
    // workerd: the isolate keeps an LRU, and the shared edge tier is
    // `caches.default` (not the KV the cache module defaults to there).
    if (
      typeof (globalThis as { Cloudflare?: unknown }).Cloudflare === "object"
    ) {
      return undefined;
    }
    const provider = this.alepha.inject(CacheProvider);
    return provider instanceof MemoryCacheProvider ? undefined : provider;
  }

  /**
   * The language segment: present whenever `alepha/react/i18n` is installed,
   * since `__ssr` carries it and `<html lang>` is in the body.
   */
  public lang(): string | undefined {
    const value = this.alepha.store.getUntracked(
      "alepha.react.i18n.lang" as never,
    ) as unknown;
    return typeof value === "string" ? value : undefined;
  }

  /**
   * Every query parameter the page or a parent layer declares.
   */
  protected declaredQuery(route: PageRoute): Set<string> {
    const names = new Set<string>();
    for (let it: PageRoute | undefined = route; it; it = it.parent) {
      const shape = (it.schema?.query as { shape?: Record<string, unknown> })
        ?.shape;
      for (const name of Object.keys(shape ?? {})) {
        names.add(name);
      }
    }
    return names;
  }

  protected paramsSegment(params: Record<string, unknown>): string {
    const names = Object.keys(params)
      .filter((name) => params[name] !== undefined)
      .sort();
    if (names.length === 0) {
      return "-";
    }
    return names
      .map((name) => `${name}=${this.stringify(params[name])}`)
      .join("&");
  }

  protected stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  /**
   * One key segment, escaped so a `:` in a value cannot shift a boundary.
   */
  protected segment(value: string): string {
    return encodeURIComponent(value);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The tee a page render writes its shared bytes into, as they stream to the
 * visitor.
 *
 * The template writes every chunk here except the private script, marks
 * where the private script went, and says at the end whether the render
 * finished cleanly: an error page, a meta-refresh redirect or a failed React
 * stream all close the response normally, so the bytes alone cannot tell.
 */
export class PageCacheSink {
  protected readonly chunks: Uint8Array[] = [];
  protected boundary = -1;
  protected recording = true;
  protected settle!: (clean: boolean) => void;

  /**
   * `true` once the template finished cleanly, `false` on any failure;
   * `undefined` while the render runs.
   */
  public clean?: boolean;

  /**
   * Settles with {@link clean} when the template is done.
   */
  public readonly finished = new Promise<boolean>((resolve) => {
    this.settle = resolve;
  });

  public write(chunk: Uint8Array): void {
    if (this.recording && this.clean === undefined) {
      this.chunks.push(chunk);
    }
  }

  /**
   * The private script starts: what follows is not shared until
   * {@link endPrivate}.
   */
  public beginPrivate(): void {
    this.boundary = this.chunks.length;
    this.recording = false;
  }

  public endPrivate(): void {
    this.recording = true;
  }

  public done(clean: boolean): void {
    if (this.clean !== undefined) {
      return;
    }
    // No private boundary means the document never reached its hydration
    // scripts: not a page that can be replayed.
    this.clean = clean && this.boundary >= 0;
    this.settle(this.clean);
  }

  /**
   * The shared bytes, split where the private script goes.
   */
  public parts(): { head: string; tail: string } {
    const join = (chunks: Uint8Array[]) => {
      const decoder = new TextDecoder();
      return (
        chunks
          .map((chunk) => decoder.decode(chunk, { stream: true }))
          .join("") + decoder.decode()
      );
    };
    return {
      head: join(this.chunks.slice(0, this.boundary)),
      tail: join(this.chunks.slice(this.boundary)),
    };
  }
}

export interface PageCacheEntry {
  /**
   * The shared bytes before the private script.
   */
  head: string;

  /**
   * The shared bytes after it (the closing tags).
   */
  tail: string;

  status: number;

  verdict: ReadVerdict;

  /**
   * The headers the page set, without `set-cookie`, `cache-control` and the
   * per-response ones.
   */
  headers: Record<string, string | string[]>;
}

export type PageCachePlan = { key: string; ttlMs: number } | { bypass: string };

interface LocalEntry {
  entry: PageCacheEntry;
  expiresAt: number;
}

const envSchema = z.object({
  REACT_PAGE_CACHE: z
    .boolean()
    .describe(
      "Turn the automatic SSR page cache off (false) without a code change, for an incident.",
    )
    .meta({ secret: false })
    .optional(),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof envSchema>> {}
}

/**
 * Page cache configuration atom.
 */
export const reactPageCacheOptions = $atom({
  name: "alepha.react.page.cache",
  schema: z.object({
    enabled: z
      .boolean()
      .describe("Whether shareable pages are cached automatically."),
    max: z
      .number()
      .describe(
        "Most entries the in-process tier keeps before evicting the least recently used.",
      ),
    anonymousCheck: z
      .boolean()
      .describe(
        "Outside production, render a page again as an anonymous visitor before its first cache write, and refuse the write when the two differ.",
      ),
  }),
  default: {
    enabled: true,
    max: 1000,
    anonymousCheck: true,
  },
  serverOnly: true,
});

export type ReactPageCacheOptions = Infer<typeof reactPageCacheOptions.schema>;

declare module "alepha" {
  interface State {
    [reactPageCacheOptions.key]: ReactPageCacheOptions;
  }
}
