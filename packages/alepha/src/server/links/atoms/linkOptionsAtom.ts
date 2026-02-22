import { $atom, t } from "alepha";

export const linkOptionsAtom = $atom({
  name: "alepha.server.links.options",
  description: "Configuration options for the links module.",
  schema: t.object({
    batch: t.boolean({
      description: "Enable batch collection for browser-side calls.",
      default: true,
    }),
  }),
  default: {
    batch: true,
  },
});
