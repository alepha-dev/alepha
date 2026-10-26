import { $inject } from "alepha";
import { $ai, aiFillFormTool, aiNavigateTool } from "alepha/ai";

import { NotesApi } from "./NotesApi.ts";

/**
 * The assistant: a stable system prompt (the vendor caches it) and the
 * app's own actions as tools. `createNote` is a POST, so the chat asks the
 * user before it runs; `listNotes` runs on its own. `navigate` and
 * `fillForm` run in the browser.
 */
export class NotesAssistant {
  protected readonly api = $inject(NotesApi);

  public readonly assistant = $ai({
    system:
      "You are the assistant of a small notes app. Answer briefly. Use the tools to read or add notes. When the user asks to draft a note without saving it, fill the form on the page instead of adding it.",
    tools: [
      this.api.listNotes,
      this.api.createNote,
      aiNavigateTool,
      aiFillFormTool,
    ],
    maxTokens: 1024,
  });
}
