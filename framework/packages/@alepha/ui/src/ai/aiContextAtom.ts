import { $atom, z } from "alepha";

/**
 * The page contexts mounted right now, outermost first: each
 * `useAiContext()` pushes one on mount and removes it on unmount, and a turn
 * sends the innermost. An `$atom` rather than React Context, so the chat
 * drawer, mounted anywhere, reads what the page below it declared.
 *
 * `formId` names the form the page offers to `fillForm`, kept in
 * `AiFormRegistry` (a form is not serializable, so it does not live here).
 */
export const aiContextAtom = $atom({
  name: "alepha.ui.ai.context",
  schema: z.array(
    z.object({
      id: z.text(),
      page: z.text().optional(),
      data: z.any().optional(),
      formId: z.text().optional(),
    }),
  ),
  default: [],
});
