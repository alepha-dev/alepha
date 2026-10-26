import { $module } from "alepha";
import { AlephaApiAi } from "alepha/api/ai";
import { AlephaOrm } from "alepha/orm";

import { NotesApi } from "./NotesApi.ts";
import { NotesAssistant } from "./NotesAssistant.ts";

/**
 * The server half: two actions, the assistant that uses them, and
 * `AlephaApiAi` for the conversations, the streams and the budget.
 *
 * @module ai.api
 */
export const AiExampleApi = $module({
  name: "ai.api",
  imports: [AlephaOrm, AlephaApiAi],
  services: [NotesApi, NotesAssistant],
});
