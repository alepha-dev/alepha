import { $atom, z } from "alepha";

export const linkOptionsAtom = $atom({
  name: "alepha.server.links.options",
  description: "Configuration options for the links module.",
  schema: z.object({
    batch: z
      .boolean()
      .describe("Enable batch collection for browser-side calls.")
      .default(true),
  }),
  default: {
    batch: true,
  },
});
