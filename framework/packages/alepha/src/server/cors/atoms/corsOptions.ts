import { $atom, type Infer, z } from "alepha";

/**
 * CORS configuration atom (global defaults)
 */
export const corsOptions = $atom({
  name: "alepha.server.cors.options",
  schema: z.object({
    origin: z
      .string()
      .describe(
        "Allowed origins (* for all, string for single, comma-separated for multiple)",
      )
      .default("*")
      .optional(),
    methods: z
      .array(z.string())
      .describe("Allowed HTTP methods")
      .default(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    headers: z
      .array(z.string())
      .describe("Allowed headers")
      .default(["Content-Type", "Authorization"]),
    credentials: z
      .boolean()
      .describe("Allow credentials")
      .default(false)
      .optional(),
    maxAge: z
      .number()
      .describe("Preflight cache duration in seconds")
      .optional(),
  }),
  default: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    headers: ["Content-Type", "Authorization"],
    credentials: false,
  },
  serverOnly: true,
});

export type CorsOptions = Infer<typeof corsOptions.schema>;

declare module "alepha" {
  interface State {
    [corsOptions.key]: CorsOptions;
  }
}
