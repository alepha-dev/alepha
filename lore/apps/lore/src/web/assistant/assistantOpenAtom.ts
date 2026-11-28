import { $atom, z } from "alepha";

/**
 * Whether the assistant's panel is open (#Q3211). An `$atom` so the header
 * button, on whichever page draws it, and the panel, mounted once at the
 * layout's root, agree.
 */
export const assistantOpenAtom = $atom({
  name: "lore.assistant.open",
  schema: z.boolean(),
  default: false,
});

/**
 * What the assistant's conversation is doing (#Q4563), as `AiChat` reports
 * it: the header's chat button shows it while the panel is closed, since
 * closing never stops a turn.
 */
export const assistantActivityAtom = $atom({
  name: "lore.assistant.activity",
  schema: z.enum(["idle", "running", "waiting", "unread"]),
  default: "idle",
});
