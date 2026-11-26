import { $atom, z } from "alepha";

/**
 * Which panel holds the right of the page (#Q4515): the assistant, a job
 * watched from the header's jobs list, or none. One at a time, and the
 * modules that draw them do not know each other: each one that opens says
 * so here, and each one that is not named closes.
 */
export const sidePanelAtom = $atom({
  name: "lore.shell.sidePanel",
  schema: z.object({ panel: z.string().optional() }),
  default: {},
});
