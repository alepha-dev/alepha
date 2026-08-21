import {
  $inject,
  Alepha,
  AlephaError,
  type FileLike,
  type Infer,
  isFileLike,
  type ZObject,
  type ZType,
} from "alepha";
import { $cache } from "alepha/cache";
import type { DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { HttpError } from "../errors/HttpError.ts";
import { isMultipart } from "../helpers/isMultipart.ts";
import type {
  ServerRequestConfigEntry,
  TRequestBody,
  TResponseBody,
} from "../interfaces/ServerRequest.ts";
import type { ClientRequestOptions } from "../primitives/$action.ts";
import { errorSchema } from "../schemas/errorSchema.ts";

export class HttpClient {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  public readonly cache = $cache<HttpClientCache>({
    provider: "memory",
    name: "http:client",
  });

  protected readonly pendingRequests: HttpClientPendingRequests = {};

  public async fetchAction(args: FetchActionArgs): Promise<FetchResponse> {
    const route = args.action; // our link to fetch
    const options = args.options ?? {}; // fetch standard options, cache, etc.
    const config = args.config ?? {}; // params, query, body, etc.
    const host = args.host ?? ""; // remote host, e.g. "https://api.example.com" or empty (for browser)

    const request: RequestInit = {
      ...options.request,
    };

    const method = route.method;
    const headers: Record<string, string> = {};
    const url = this.url(host, route, config);

    await this.alepha.events.emit("client:onRequest", {
      route,
      config,
      options,
      headers,
      request,
    });

    request.method ??= method;

    await this.body(request, headers, route, config);

    request.headers = {
      ...config.headers,
      ...Object.fromEntries(new Headers(request.headers).entries()),
      ...headers,
    };

    return await this.fetch(url, {
      ...request,
      schema: route.schema,
      ...options,
    });
  }

  public async fetch<T extends ZType>(
    url: string,
    request: RequestInitWithOptions<T> = {}, // standard options
  ): Promise<FetchResponse<Infer<T>>> {
    const options = {
      cache: request.localCache,
      schema: request.schema?.response,
      key: request.key,
    };

    request.method ??= "GET";

    this.log.trace("Request", {
      url,
      method: request.method,
      body: request.body,
      headers: request.headers,
      options,
    });

    // Namespace the shared cache + in-flight dedup by the caller's identity.
    // On the server one singleton HttpClient serves many users concurrently
    // (SSR, forwarded remote-action calls), so keying purely by URL would let
    // one user receive another user's cached or in-flight response. Anonymous
    // requests (no authorization/cookie) resolve to "", leaving browser
    // behaviour unchanged.
    const identityScope = this.identityScope(request);
    const cacheKey = url + identityScope;

    // Only add automatic ETag if user didn't explicitly provide headers
    const cached = await this.cache.get(cacheKey);
    if (cached && request.method === "GET") {
      if (cached.etag) {
        request.headers = new Headers(request.headers);
        if (!request.headers.has("if-none-match")) {
          request.headers.set("if-none-match", cached.etag);
        }
      } else {
        return {
          data: cached.data as Infer<T>,
          status: 200,
          statusText: "OK",
          headers: new Headers(),
        };
      }
    }

    await this.alepha.events.emit("client:beforeFetch", {
      url,
      options,
      request,
    });

    // Deduplicate concurrent identical requests for idempotent methods only.
    // Non-idempotent methods (POST, PUT, PATCH, DELETE) must always execute
    // since each call may produce a different side effect.
    const isIdempotent =
      request.method === "GET" ||
      request.method === "HEAD" ||
      request.method === "OPTIONS";
    const key =
      options.key ??
      (isIdempotent
        ? JSON.stringify({ url, method: request.method, scope: identityScope })
        : undefined);

    if (key) {
      const existing = this.pendingRequests[key];
      if (existing) {
        // Log the URL, not the raw key (which carries the identity hash).
        this.log.info("Request already pending", {
          url,
          method: request.method,
        });
        return existing;
      }
    }

    const promise = fetch(url, request)
      .then(async (response) => {
        this.log.debug("Response", {
          url,
          status: response.status,
        });

        const fetchResponse: FetchResponse = {
          data: await this.responseData(response, options),
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          raw: response,
        };

        if (request.method === "GET") {
          if (options.cache) {
            await this.cache.set(
              cacheKey,
              { data: fetchResponse.data },
              typeof options.cache === "boolean" ? undefined : options.cache,
            );
          } else if (!this.alepha.isBrowser()) {
            // only cache etag on server, browser can handle etag itself
            const etag = response.headers.get("etag") ?? undefined;
            if (etag) {
              await this.cache.set(cacheKey, {
                data: fetchResponse.data,
                etag,
              });
            }
          }
        }

        return fetchResponse;
      })
      .finally(() => {
        if (key) {
          delete this.pendingRequests[key];
        }
      });

    if (key) {
      this.pendingRequests[key] = promise;
    }

    return promise;
  }

  /**
   * Derive a per-identity discriminant from the request's credentials so the
   * shared cache and in-flight dedup can't hand one user another's response.
   * Returns "" when no authorization/cookie is present (anonymous), keeping the
   * key equal to the bare URL. The credential material is hashed, never placed
   * verbatim into a key that may be logged.
   */
  protected identityScope(request: { headers?: HeadersInit }): string {
    if (!request.headers) {
      return "";
    }
    const headers = new Headers(request.headers);
    const auth = headers.get("authorization") ?? "";
    const cookie = headers.get("cookie") ?? "";
    if (!auth && !cookie) {
      return "";
    }
    // Escapes, not literal control bytes: raw \x00 in the source makes the
    // whole file "binary" to grep/git-diff/code search, which silently return
    // nothing for it.
    return `\u0000${this.hashScope(`${auth}\u0001${cookie}`)}`;
  }

  /**
   * Fast, collision-resistant string hash (two FNV-1a accumulators combined).
   * Used only to namespace a cache — not a security boundary; the remote still
   * authorizes every request.
   */
  protected hashScope(input: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5 ^ 0x1234567;
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x01000193);
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }

  protected url(
    host: string,
    action: HttpAction,
    args: ServerRequestConfigEntry,
  ) {
    let url = host;

    if (action.prefix) {
      url += action.prefix;
    }

    url += action.path;
    url = this.pathVariables(url, action, args);
    url = this.queryParams(url, action, args);

    return url;
  }

  protected async body(
    init: RequestInit,
    headers: Record<string, string>,
    action: HttpAction,
    args: ServerRequestConfigEntry = {},
  ) {
    const hasHeader =
      typeof init.headers === "object" &&
      "content-type" in init.headers &&
      init.headers["content-type"] === "multipart/form-data";

    if (hasHeader || isMultipart(action)) {
      if (typeof init.headers === "object" && "content-type" in init.headers) {
        delete (init.headers as Record<string, unknown>)["content-type"]; // fetch() will fill this for us
      }

      const formData = new FormData();

      for (const [key, value] of Object.entries(args.body ?? {})) {
        if (typeof value === "string") {
          formData.append(key, value);
          continue;
        }
        if (value instanceof Blob) {
          formData.append(key, value);
          continue;
        }
        if (isFileLike(value)) {
          // FileLike must be transformed to WebFile
          formData.append(
            key,
            new File([await value.arrayBuffer()], value.name, {
              type: value.type,
            }),
          );
        }
      }

      init.body = formData;

      return;
    }

    if (!init.body && action.schema?.body) {
      headers["content-type"] = "application/json";
      init.body = this.alepha.codec.encode(action.schema?.body, args.body, {
        as: "string",
      });
    }
  }

  protected async responseData(
    response: Response,
    options: ResolvedFetchOptions,
  ): Promise<any> {
    if (response.status === 304) {
      let cacheKey = response.url;
      if (typeof window !== "undefined") {
        cacheKey = cacheKey.replace(window.location.origin, "");
      }

      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached.data;
      }

      // if no cached data (etag-only routes), return empty string
      return "";
    }

    if (response.status === 204) {
      return;
    }

    if (this.isMaybeFile(response)) {
      return this.createFileLike(response);
    }

    if (response.headers.get("Content-Type")?.startsWith("text/")) {
      return await response.text();
    }

    if (response.headers.get("Content-Type")?.startsWith("application/json")) {
      const json = await response.json();

      if (response.status >= 400) {
        const jsonError = this.alepha.codec.decode(errorSchema, json);
        const error = new HttpError(jsonError);

        await this.alepha.events.emit("client:onError", {
          error,
        });

        throw error;
      }

      if (options.schema) {
        return this.alepha.codec.decode(options.schema, json);
      }

      return json;
    }

    if (response.status >= 400) {
      const error = new HttpError({
        status: response.status,
        message: `An error occurred while fetching the resource. (${response.statusText})`,
      });

      await this.alepha.events.emit("client:onError", {
        error,
      });

      throw error;
    }

    return response;
  }

  protected isMaybeFile(response: Response): boolean {
    const contentType = response.headers.get("Content-Type");
    if (!contentType) {
      return false;
    }

    if (response.headers.get("Content-Disposition")?.includes("attachment")) {
      return true; // If Content-Disposition indicates an attachment, treat it as a file
    }

    return (
      contentType.startsWith("application/octet-stream") ||
      contentType.startsWith("application/pdf") ||
      contentType.startsWith("application/zip") ||
      contentType.startsWith("image/") ||
      contentType.startsWith("video/") ||
      contentType.startsWith("audio/")
    );
  }

  protected createFileLike(response: Response, defaultFileName = ""): FileLike {
    const match = (response.headers.get("Content-Disposition") ?? "").match(
      /filename="(.+)"/,
    );
    return {
      name: match?.[1] ? match[1] : defaultFileName,
      type: response.headers.get("Content-Type") ?? "application/octet-stream",
      size: Number(response.headers.get("Content-Length") ?? 0),
      lastModified: Date.now(),
      stream: () => {
        // `response.body` was right there — throwing here broke every
        // consumer piping a downloaded file straight into a bucket. A body
        // can only be read once, so say so instead of returning a stream
        // that silently yields nothing.
        if (response.bodyUsed) {
          throw new AlephaError(
            "This response body has already been consumed; stream() can only be called once.",
          );
        }
        if (!response.body) {
          throw new AlephaError("This response has no body to stream.");
        }
        return response.body;
      },
      arrayBuffer: async () => {
        return await response.arrayBuffer();
      },
      text: async () => {
        return await response.text();
      },
    };
  }

  public pathVariables(
    url: string,
    action: { schema?: { params?: ZObject } },
    args: ServerRequestConfigEntry = {},
  ): string {
    if (typeof args.params === "object") {
      const params = action.schema?.params
        ? (this.alepha.codec.decode(
            action.schema.params,
            args.params,
          ) as Record<string, any>)
        : args.params;

      // One regex pass, substituting only declared keys:
      //
      // - the token is matched whole, so `:id` can no longer eat the prefix of
      //   `:idType` (`/a/:idType/:id` used to become `/a/1Type/:id`);
      // - a replace *function* means `$&` / `$'` inside a value stay literal
      //   instead of being expanded as substitution patterns;
      // - values are percent-encoded, so `/`, `?`, `#` and spaces can no
      //   longer break out of their segment.
      //
      // Unknown tokens are left untouched — that also keeps the port in
      // `http://host:3000` from being read as a parameter.
      url = url.replace(
        /\{([A-Za-z0-9_]+)\}|:([A-Za-z0-9_]+)/g,
        (match, braced, colon) => {
          const key = braced ?? colon;
          return Object.hasOwn(params, key)
            ? encodeURIComponent(String(params[key]))
            : match;
        },
      );
    }

    return url;
  }

  public queryParams(
    url: string,
    action: { schema?: { query?: ZObject } },
    args: ServerRequestConfigEntry = {},
  ): string {
    if (typeof args.query === "object") {
      const query = action.schema?.query
        ? this.alepha.codec.decode(action.schema.query, args.query ?? {})
        : args.query;

      for (const key of Object.keys(query)) {
        if (query[key] === undefined) {
          delete query[key];
        }
        if (typeof query[key] === "object") {
          query[key] = JSON.stringify(query[key]);
        }
      }

      const params = new URLSearchParams(
        query as Record<string, string>,
      ).toString();
      return params ? `${url}?${params}` : url;
    }
    return url;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface FetchOptions<T extends ZType = ZType> {
  /**
   * Key to identify the request in the pending requests.
   */
  key?: string;

  /**
   * The schema to validate the response against.
   */
  schema?: {
    response?: T;
  };

  /**
   * Built-in cache options.
   */
  localCache?: boolean | number | DurationLike;
}

export type RequestInitWithOptions<T extends ZType = ZType> = RequestInit &
  FetchOptions<T>;

/**
 * Internal resolved fetch options — built in {@link HttpClient.fetch},
 * consumed by {@link HttpClient.responseData} and the `client:beforeFetch`
 * event. Distinct from the external {@link FetchOptions}: `schema` is the
 * already-unwrapped response schema and `cache` is the resolved cache directive.
 */
export interface ResolvedFetchOptions {
  key?: string;
  schema?: ZType;
  cache?: boolean | number | DurationLike;
}

export interface FetchResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  raw?: Response;
}

export type HttpClientPendingRequests = Record<
  string,
  Promise<any> | undefined
>;

interface HttpClientCache {
  data: any;
  etag?: string;
}

export interface FetchActionArgs {
  action: HttpAction;
  host?: string;
  config?: ServerRequestConfigEntry;
  options?: ClientRequestOptions;
}

export interface HttpAction {
  method?: string;
  prefix?: string;
  path: string;
  contentType?: string;
  requestBodyType?: string;
  schema?: {
    params?: ZObject;
    query?: ZObject;
    body?: TRequestBody;
    response?: TResponseBody;
  };
}
