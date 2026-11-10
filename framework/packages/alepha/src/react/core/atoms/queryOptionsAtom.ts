import { $atom, type Infer, z } from "alepha";

/**
 * App-wide defaults of every `useQuery`.
 *
 * A query's own option wins over the field here. Set it on the container to
 * change the default for the whole app, or for one spec file:
 *
 * ```ts
 * alepha.store.mut(queryOptionsAtom, (options) => ({ ...options, retry: 0 }));
 * ```
 */
export const queryOptionsAtom = $atom({
  name: "alepha.react.query.options",
  description: "App-wide defaults of useQuery.",
  schema: z.object({
    retry: z
      .union([z.number(), z.literal(false)])
      .describe(
        "How many times a failed read is tried again after its first attempt, on a network failure or a 408, 502, 503 or 504. Waits 1 s, then doubles, capped at 30 s, with jitter. `0` or `false` turns retries off.",
      )
      .default(2),
    refetchOnReconnect: z
      .boolean()
      .describe(
        "When the browser comes back online, re-run every mounted keyed query whose entry is stale or whose last run failed. The entry is kept while it runs.",
      )
      .default(true),
    refetchOnFocus: z
      .boolean()
      .describe(
        "When the page becomes visible again, re-run every mounted keyed query whose entry is stale. Off by default: with staleTime at 0, every keyed query is stale.",
      )
      .default(false),
    gcTime: z
      .union([z.number(), z.tuple([z.number(), z.string()]), z.literal(false)])
      .describe(
        "How long an entry nobody observes stays in the cache, as milliseconds or a [number, unit] tuple; never less than the staleTime it was read with. `false` keeps entries for the life of the page.",
      )
      .default([5, "minutes"]),
  }),
  default: {
    retry: 2,
    refetchOnReconnect: true,
    refetchOnFocus: false,
    gcTime: [5, "minutes"],
  },
});

export type QueryOptions = Infer<typeof queryOptionsAtom.schema>;

declare module "alepha" {
  interface State {
    [queryOptionsAtom.key]: QueryOptions;
  }
}
