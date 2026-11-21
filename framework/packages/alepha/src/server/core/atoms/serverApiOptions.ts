import { $atom, type Infer, z } from "alepha";

/**
 * Server API configuration atom.
 */
export const serverApiOptions = $atom({
  name: "alepha.server.api.options",
  schema: z.object({
    prefix: z.text({
      default: "/api",
      description: "Prefix for all API routes (e.g. $action).",
    }),
    timeout: z
      .integer()
      .describe(
        "Milliseconds every $action may run before it answers 503 (TimeoutError). Unset or 0: no timeout. An action's own `timeout` wins.",
      )
      .optional(),
  }),
  default: {
    prefix: "/api",
  },
});

export type ServerApiOptions = Infer<typeof serverApiOptions.schema>;

declare module "alepha" {
  interface State {
    [serverApiOptions.key]: ServerApiOptions;
  }
}
