import { $atom, type Static, t } from "alepha";

export const appEntryOptions = $atom({
  name: "alepha.cli.appEntry.options",
  schema: t.object({
    server: t.optional(t.text()),
    browser: t.optional(t.text()),
    style: t.optional(t.text()),
  }),
  default: {},
});

export type AppEntryOptions = Static<typeof appEntryOptions.schema>;
