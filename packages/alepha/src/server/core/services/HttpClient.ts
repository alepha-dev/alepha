import {
  $inject,
  Alepha,
  AlephaError,
  type FileLike,
  isFileLike,
  type Static,
  type TObject,
  type TSchema,
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

  public async fetch<T extends TSchema>(
    url: string,
    request: RequestInitWithOptions<T> = {}, // standard options
  ): Promise<FetchResponse<Static<T>>> {
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

    // Only add automatic ETag if user didn't explicitly provide headers
    const cached = await this.cache.get(url);
    if (cached && request.method === "GET") {
      if (cached.etag) {
        request.headers = new Headers(request.headers);
        if (!request.headers.has("if-none-match")) {
          request.headers.set("if-none-match", cached.etag);
        }
      } else {
        return {
          data: cached.data as Static<T>,
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
        ? JSON.stringify({ url, method: request.method })
        : undefined);

    if (key) {
      const existing = this.pendingRequests[key];
      if (existing) {
        this.log.info("Request already pending", key);
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
              url,
              { data: fetchResponse.data },
              typeof options.cache === "boolean" ? undefined : options.cache,
            );
          } else if (!this.alepha.isBrowser()) {
            // only cache etag on server, browser can handle etag itself
            const etag = response.headers.get("etag") ?? undefined;
            if (etag) {
              await this.cache.set(url, { data: fetchResponse.data, etag });
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
        throw new AlephaError("Not implemented");
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
    action: { schema?: { params?: TObject } },
    args: ServerRequestConfigEntry = {},
  ): string {
    if (typeof args.params === "object") {
      const params = action.schema?.params
        ? (this.alepha.codec.decode(
            action.schema.params,
            args.params,
          ) as Record<string, any>)
        : args.params;

      for (const key of Object.keys(params)) {
        url = url.replace(`:${key}`, params[key]);
        url = url.replace(`{${key}}`, params[key]);
      }
    }

    return url;
  }

  public queryParams(
    url: string,
    action: { schema?: { query?: TObject } },
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

export interface FetchOptions<T extends TSchema = TSchema> {
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

export type RequestInitWithOptions<T extends TSchema = TSchema> = RequestInit &
  FetchOptions<T>;

/**
 * Internal resolved fetch options — built in {@link HttpClient.fetch},
 * consumed by {@link HttpClient.responseData} and the `client:beforeFetch`
 * event. Distinct from the external {@link FetchOptions}: `schema` is the
 * already-unwrapped response schema and `cache` is the resolved cache directive.
 */
export interface ResolvedFetchOptions {
  key?: string;
  schema?: TSchema;
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
    params?: TObject;
    query?: TObject;
    body?: TRequestBody;
    response?: TResponseBody;
  };
}
