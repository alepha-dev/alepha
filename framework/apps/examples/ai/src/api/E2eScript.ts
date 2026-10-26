import { $hook, $inject } from "alepha";
import { AiProvider, MemoryAiProvider } from "alepha/ai";

/**
 * The e2e scenario's model, registered only when `AI_E2E=1` (see
 * `main.server.ts`): the in-memory provider answers the two model calls of
 * "add a note" with a scripted tool call, then a reply. It is the same
 * `MemoryAiProvider` specs script.
 */
export class E2eScript {
  protected readonly ai = $inject(AiProvider);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      if (!(this.ai instanceof MemoryAiProvider)) {
        return;
      }
      this.ai.script([
        { type: "text", text: "I will add it." },
        {
          type: "tool_call",
          id: "call-e2e-1",
          name: "createNote",
          input: { body: { text: "Buy milk" } },
        },
      ]);
      this.ai.script([{ type: "text", text: "Done: the note is added." }]);
    },
  });
}
