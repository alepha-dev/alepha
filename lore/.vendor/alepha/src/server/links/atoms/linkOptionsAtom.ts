import { $atom, z } from "alepha";

export const linkOptionsAtom = $atom({
  name: "alepha.server.links.options",
  description: "Configuration options for the links module.",
  schema: z.object({
    batch: z
      .boolean()
      .describe("Enable batch collection for browser-side calls.")
      .default(true),

    remoteRegistryTtl: z
      .number()
      .describe(
        "Seconds a remote app's action registry is held before it is revalidated. The endpoint emits an ETag, so an expired entry costs a 304 rather than a payload.",
      )
      .default(300),

    hostname: z
      .string()
      .describe(
        "Origin every host-less browser call goes to, e.g. https://api.example.com. Unset, a browser calls its own origin. Set in a native shell, whose WebView origin (capacitor://localhost) is not the API. Never applied on the server, and never to a client whose scope or call names a hostname of its own.",
      )
      .optional(),
  }),
  default: {
    batch: true,
    remoteRegistryTtl: 300,
  },
});
