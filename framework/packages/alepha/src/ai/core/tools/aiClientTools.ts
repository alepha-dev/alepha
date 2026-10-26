import { z } from "alepha";

import { clientTool } from "../primitives/$ai.ts";

/**
 * The `navigate` client tool: opens a page of the app by its page name.
 * `<AiChat />` and `useAiChat()` (`@alepha/ui/ai`) run it with the typed
 * router, so the model can only reach pages that exist.
 *
 * @example
 * ```ts
 * support = $ai({ system, tools: [this.api.list, aiNavigateTool] });
 * ```
 */
export const aiNavigateTool = clientTool("navigate", {
  description:
    "Open a page of the app for the user. `page` is a page name the app declares, `params` its path parameters.",
  schema: z.object({
    page: z.text({ maxLength: 128 }),
    params: z.record(z.text(), z.text()).optional(),
  }),
});

/**
 * The `fillForm` client tool: fills the form the current page offered with
 * `useAiContext({ form })`, field by field, and never submits it. Pages that
 * offer no form cannot be filled.
 */
export const aiFillFormTool = clientTool("fillForm", {
  description:
    "Fill fields of the form on the current page, which the user then reviews and submits. `values` maps field names to values. Only works on a page that offers a form.",
  schema: z.object({
    values: z.record(z.text(), z.any()),
  }),
});
