import { $atom, type Static, z } from "alepha";

export const appEntryOptions = $atom({
  name: "alepha.cli.appEntry.options",
  schema: z.object({
    server: z.text().optional(),
    browser: z.text().optional(),
    style: z.text().optional(),
  }),
  default: {},
  serverOnly: true,
});

export type AppEntryOptions = Static<typeof appEntryOptions.schema>;
