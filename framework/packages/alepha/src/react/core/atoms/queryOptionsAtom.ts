import { $atom, type Infer, z } from "alepha";

/**
 * App-wide defaults of every `useQuery`.
 *
 * A query's own option wins over the field here. Set it on the container to
 * change the default for the whole app, or for one spec file:
 *
 * ```ts
 * alepha.store.set(queryOptionsAtom, { retry: 0 });
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
  }),
  default: {
    retry: 2,
  },
});

export type QueryOptions = Infer<typeof queryOptionsAtom.schema>;

declare module "alepha" {
  interface State {
    [queryOptionsAtom.key]: QueryOptions;
  }
}
