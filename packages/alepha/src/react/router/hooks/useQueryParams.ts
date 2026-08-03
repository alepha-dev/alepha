import { type Alepha, type Infer, type ZObject, z } from "alepha";
import { useAlepha } from "alepha/react";
import { useEffect, useState } from "react";
import { useRouter } from "./useRouter.ts";
import { useRouterState } from "./useRouterState.ts";

/**
 * Hook to manage query parameters in the URL using a defined schema.
 *
 * Two storage formats are supported via {@link UseQueryParamsHookOptions.format}:
 * - `"base64"` (default) packs the whole object into a single opaque param
 *   (named by `key`, default `q`) — e.g. `?q=eyJ0YWIiOiJzZWN1cml0eSJ9`.
 * - `"querystring"` spreads each schema field across its own readable param —
 *   e.g. `?tab=security`. In this mode `key` is ignored.
 *
 * By default the URL is updated with `replaceState` (no new history entry).
 * Pass `push: true` to add a history entry instead, so the browser back
 * button steps back through previous values.
 *
 * @example
 * const [params, setParams] = useQueryParams(
 *   z.object({ tab: z.string().optional() }),
 *   { format: "querystring" },
 * );
 * // params.tab reads from `?tab=…`; setParams({ tab: "security" }) writes it.
 */
export const useQueryParams = <T extends ZObject>(
  schema: T,
  options: UseQueryParamsHookOptions = {},
): [Partial<Infer<T>>, (data: Infer<T>) => void] => {
  const alepha = useAlepha();
  const router = useRouter();
  // Subscribe to router-state changes: navigations this component did not
  // initiate (back/forward, another component's push) must re-render it so
  // the sync effect below can observe the new URL.
  useRouterState();

  const key = options.key ?? "q";
  const format = options.format ?? "base64";

  // The slice of the URL this hook reads from: a single opaque param in
  // base64 mode, or the schema's own field names in querystring mode.
  const read = (): Partial<Infer<T>> | undefined =>
    format === "querystring"
      ? decodeQueryString(alepha, schema, router.query)
      : decodeBase64(alepha, schema, router.query[key]);

  // A primitive the effect can depend on so it re-syncs only when the
  // relevant part of the URL actually changes.
  const signature =
    format === "querystring"
      ? Object.keys(z.schema.shape(schema))
          .map((name) => `${name}=${router.query[name] ?? ""}`)
          .join("&")
      : router.query[key];

  const [queryParams = {}, setQueryParams] = useState<
    Partial<Infer<T>> | undefined
  >(read());

  useEffect(() => {
    setQueryParams(read());
  }, [signature]);

  return [
    queryParams,
    (next: Infer<T>) => {
      setQueryParams(next);
      router.setQueryParams(
        (data) =>
          format === "querystring"
            ? writeQueryString(alepha, schema, data, next)
            : { ...data, [key]: encodeBase64(alepha, schema, next) },
        { push: options.push },
      );
    },
  ];
};

// ---------------------------------------------------------------------------------------------------------------------

export interface UseQueryParamsHookOptions {
  /**
   * How the params are stored in the URL.
   * - `"base64"` (default): the whole object in one opaque param (`key`).
   * - `"querystring"`: each schema field as its own readable param (`key`
   *   is ignored).
   */
  format?: "base64" | "querystring";
  /**
   * Param name used in `"base64"` format. Defaults to `"q"`. Ignored in
   * `"querystring"` format, where the schema's field names are used.
   */
  key?: string;
  /**
   * When `true`, updates push a new browser-history entry (`pushState`) so
   * the back button returns to the previous value. Defaults to `false`,
   * which replaces the current entry in place (`replaceState`).
   */
  push?: boolean;
}

const encodeBase64 = (alepha: Alepha, schema: ZObject, data: any) => {
  return btoa(JSON.stringify(alepha.codec.decode(schema, data)));
};

const decodeBase64 = <T extends ZObject>(
  alepha: Alepha,
  schema: T,
  data: any,
): Infer<T> | undefined => {
  try {
    return alepha.codec.decode(
      schema,
      JSON.parse(atob(decodeURIComponent(data))),
    );
  } catch {
    return;
  }
};

/**
 * querystring read: each schema field is its own URL param. Mirrors the
 * server's per-key query decode — `codec.decode(propertySchema, rawString)`
 * coerces the raw string into the declared type (number, boolean, …).
 */
const decodeQueryString = <T extends ZObject>(
  alepha: Alepha,
  schema: T,
  query: Record<string, any>,
): Partial<Infer<T>> | undefined => {
  try {
    const out: Record<string, any> = {};
    for (const name of Object.keys(z.schema.shape(schema))) {
      const raw = query[name];
      if (raw != null && raw !== "") {
        out[name] = alepha.codec.decode(z.schema.shape(schema)[name], raw);
      }
    }
    return out as Partial<Infer<T>>;
  } catch {
    return;
  }
};

/**
 * querystring write: spread the decoded object across individual params,
 * dropping empty values so the URL stays clean. Unrelated params (not part
 * of the schema) are preserved.
 */
const writeQueryString = (
  alepha: Alepha,
  schema: ZObject,
  current: Record<string, any>,
  next: any,
): Record<string, any> => {
  const decoded = alepha.codec.decode(schema, next) as Record<string, any>;
  const merged = { ...current };
  for (const name of Object.keys(z.schema.shape(schema))) {
    const value = decoded?.[name];
    if (value == null || value === "") {
      delete merged[name];
    } else {
      merged[name] = String(value);
    }
  }
  return merged;
};
