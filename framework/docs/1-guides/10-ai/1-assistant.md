# AI assistant

`alepha/ai` puts a model behind one provider contract and gives your app an assistant that
knows the page the user is on and can run your features for them. There is no vendor SDK:
every provider is plain `fetch` and `ReadableStream`, so the same code runs on Node, Bun and
Cloudflare Workers. To let an outside client call your app's tools instead, see
[MCP Server](/docs/guides-ai-mcp).

```typescript
import { $ai, AiProvider } from "alepha/ai";
```

## Choosing a provider

The vendor is the module you register, never an env string. Without one, `MemoryAiProvider`
answers: specs script it, and in development it replies that no vendor module is registered,
so a page with a chat renders and names its own cause.

| module                                        | provider                     | for                                                    |
| --------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| `AlephaAiCloudflare` (`alepha/ai/cloudflare`) | `WorkersAiProvider`          | Workers AI through the `env.AI` binding, on Workers    |
| `AlephaAiOpenai` (`alepha/ai/openai`)         | `OpenAiCompatibleAiProvider` | OpenAI, Workers AI over REST, OpenRouter, Ollama, vLLM |
| `AlephaAiAnthropic` (`alepha/ai/anthropic`)   | `AnthropicAiProvider`        | the Anthropic Messages API, with prompt caching        |

Start with Workers AI, and fall back to Anthropic where it cannot do the job (a model without
function calling, or answers that are not good enough). The choice is per app; there is no
automatic failover between vendors.

`AlephaAiCloudflare` only substitutes the provider on Workers, so an app deployed there can
register it unconditionally and still run `alepha dev` on Node. Register `AlephaAiOpenai` after
it to reach the same Workers AI models over REST locally and in Docker:

```typescript check
import { Alepha, run } from "alepha";
import { AlephaAiCloudflare } from "alepha/ai/cloudflare";
import { AlephaAiOpenai } from "alepha/ai/openai";

run(Alepha.create().with(AlephaAiCloudflare).with(AlephaAiOpenai));
```

The first substitution wins, so the order matters: on Workers the binding provider substitutes
first and answers; elsewhere it substitutes nothing and the REST provider answers. The Cloudflare build declares the `ai` binding when the module is registered.

| variable      | read by                      | meaning                                                                                                                      |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `AI_MODEL`    | every vendor provider        | the model id; there is no default, and a vendor provider fails at start without one (unless every `$ai` names a `model`)     |
| `AI_API_KEY`  | Anthropic, OpenAI-compatible | the vendor key (a Cloudflare API token for Workers AI over REST)                                                             |
| `AI_BASE_URL` | Anthropic, OpenAI-compatible | the endpoint: Cloudflare AI Gateway, `https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1`, `http://localhost:11434/v1` |
| `AI_BINDING`  | Workers AI                   | the binding name, `AI` by default                                                                                            |

Every failure is a typed error from one family, whatever the vendor: `AiAuthError`,
`AiRateLimitError` (with `retryAfter`), `AiOverloadedError`, `AiContextLengthError`,
`AiToolsUnsupportedError` (the model cannot call tools), all extending `AiError`.

## Calling a model directly

`AiProvider` streams one response as typed events. `complete()` collects them:

```typescript check
import { $inject } from "alepha";
import { AiProvider } from "alepha/ai";

class Summary {
  ai = $inject(AiProvider);

  async summarize(text: string) {
    const reply = await this.ai.complete({
      system: "Summarize in one sentence.",
      messages: [{ role: "user", content: text }],
    });
    return reply.text;
  }
}
```

## An assistant: `$ai`

`$ai` declares an assistant whose tools are your `$action`s:

```typescript check
import { $inject, z } from "alepha";
import { $ai, type AiMessage } from "alepha/ai";
import { $secure, type UserAccountToken } from "alepha/security";
import { $action } from "alepha/server";

class InvoiceApi {
  list = $action({
    method: "GET",
    path: "/invoices",
    description: "List the invoices of the signed-in user",
    use: [$secure()],
    schema: {
      query: z.object({ status: z.enum(["open", "paid"]).optional() }),
      response: z.array(z.object({ id: z.integer(), status: z.text() })),
    },
    handler: () => [],
  });

  create = $action({
    method: "POST",
    path: "/invoices",
    description: "Create an invoice",
    use: [$secure()],
    schema: {
      body: z.object({ amount: z.number() }),
      response: z.object({ id: z.integer() }),
    },
    handler: () => ({ id: 1 }),
  });
}

class Support {
  invoices = $inject(InvoiceApi);

  assistant = $ai({
    system: "You help with invoices. Be brief.",
    tools: [this.invoices.list, this.invoices.create],
  });

  async answer(messages: AiMessage[], user: UserAccountToken) {
    const result = await this.assistant.run({ messages, user });
    return result.text;
  }
}
```

- **A tool is an action** (or a `$tool`, see below). Its name is the action's name (letters, digits, `_` and `-`, at
  most 64), its description the action's `description` (required: it is how the model knows
  when to call it), and its input an object with `params`, `query` and `body` for the parts
  the action declares. A bad name or a missing description fails at start.
- **It runs as the user.** Each call goes through `action.run(input, { user })` with the user
  you pass, so the action's own `use: [$secure(...)]` decides: the assistant can never do more
  than the user could. Without a user the call runs anonymous and a secured action refuses;
  there is no "system" fallback. A refusal, a validation error or a thrown error goes back to
  the model as a tool error, never to the browser as a 403.
- **Bounds.** `maxSteps` (10 model calls by default) ends the turn with `end: length`;
  `timeout` and the ambient abort signal cancel the call in flight.

### One definition for the assistant and for outside agents

The same `$action` can serve the assistant and outside agents at once: add `mcp: true` and,
when `alepha/mcp` is registered, it is also an MCP tool with the same `{ params, query, body }`
input (see [MCP Server](/docs/guides-ai-mcp)):

```typescript check
import { $inject, z } from "alepha";
import { $ai } from "alepha/ai";
import { $tool } from "alepha/mcp";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

class InvoiceApi {
  list = $action({
    method: "GET",
    path: "/invoices",
    description: "List the invoices of the signed-in user",
    mcp: true,
    use: [$secure()],
    schema: { response: z.array(z.object({ id: z.integer() })) },
    handler: () => [],
  });
}

class InvoiceTools {
  invoice_search = $tool({
    description: "Search invoices by customer name",
    annotations: { readOnlyHint: true },
    use: [$secure()],
    schema: { params: z.object({ customer: z.text() }) },
    handler: async () => [],
  });
}

class Support {
  invoices = $inject(InvoiceApi);
  tools = $inject(InvoiceTools);

  assistant = $ai({
    system: "You help with invoices.",
    tools: [this.invoices.list, this.tools.invoice_search],
  });
}
```

A `$tool` (`alepha/mcp`) is offered as it is, with no wrapper action. The model sees its
`description` and its `schema.params`; a call runs the tool as the turn's user, so its own
`use: [$secure(...)]` decides, with the turn's abort signal as `context.signal`. Every failure,
a refusal or invalid arguments included, goes back to the model as a tool error. A call from
the assistant is not an MCP call: `mcp:tool:call:end` does not fire for it.

## Confirmation and resume

A call to an action whose method is not `GET`, or to a `$tool` that does not declare
`annotations: { readOnlyHint: true }` (or whatever `confirm` says), does not run on its own.
`confirm` receives `{ name, method }`, where `method` is `"TOOL"` for a `$tool`. The turn pauses: `stream()` emits a `confirm` event with the call id and its input, then
`end: paused`. A client tool, declared with `clientTool(name, { description, schema })`, pauses
the same way with a `client_tool` event, because the browser runs it (`navigate`, `fillForm`).

The loop is re-entrant: its whole state is the message list. Persist every `message` event as
it comes; resuming is a new call with the stored messages and the user's answer:

```typescript
await assistant.run({
  messages: stored,
  user,
  resume: { callId, decision: "approve" },
});
await assistant.run({
  messages: stored,
  user,
  resume: { callId, result: { ok: true } },
});
```

An approved call runs the input stored in the messages, never input sent back by the browser,
and a call id nothing waits on is refused. A denial reaches the model as the tool error
"Denied by the user.". Nothing lives in memory between the two requests, which is the shape
that works on Workers.

## Page context

Pass `context: { route, page, data }` with a new turn and it rides on the user's message as a
delimited `<page-context>` block, capped at 8 KB and truncated with a marker past it. It never
goes into the system prompt: it changes every turn, which would void the vendor's prompt cache,
and it is client-sent data, which the model must read as the user's. The augmented message is
emitted as a `message` event, so what you store is what the model saw; `AiContextBlock.strip()`
removes the block for display.

The context also reaches the `allow` option, so an assistant can offer per page what the user
may do there. A resume carries the context of the page the user answers from (`useAiChat` sends
it), so the call they approved is still offered when it runs:

```typescript
class Assistant {
  invoices = $inject(InvoiceApi);

  support = $ai({
    system: "You help with invoices.",
    tools: [this.invoices.list, this.invoices.create],
    allow: ({ context }) =>
      context?.page === "invoices" ? ["list", "create"] : ["list"],
  });
}
```

The context is sent by the browser: it narrows what the model is shown, and is never a security
input. Every tool still runs its own gate.

## The server side: `alepha/api/ai`

`AlephaApiAi` stores conversations per user and serves them, on top of your `$ai`:

| endpoint                                | kind      | does                                                                  |
| --------------------------------------- | --------- | --------------------------------------------------------------------- |
| `POST /api/ai/chat`                     | `$sse`    | a new turn, in a new conversation or `conversationId`'s               |
| `POST /api/ai/conversations/:id/resume` | `$sse`    | the answer to a pause: `{ callId, decision }` or `{ callId, result }` |
| `GET /api/ai/conversations`             | `$action` | the caller's conversations, most recent first                         |
| `GET /api/ai/conversations/:id`         | `$action` | one conversation with its messages                                    |

Every endpoint is `$secure()` and scoped to the caller: another user's conversation is a 404,
never a 403. On the streams, every refusal happens before the stream opens, so it is the
response's status: 401 signed out, 404 not yours, 409 not waiting on that call, 429 over the turn
rate or the token budget (`AiBudgetExceededError`). Each message is stored as it completes,
tokens on the assistant rows; a pause stores the call, and a resume claims it once.

```typescript
import { Alepha, run } from "alepha";
import { AlephaAiCloudflare } from "alepha/ai/cloudflare";
import { AlephaApiAi } from "alepha/api/ai";

// The vendor module FIRST: AlephaApiAi registers alepha/ai, and the first
// provider substituted is the one used.
run(Alepha.create().with(AlephaAiCloudflare).with(AlephaApiAi).with(MyApp));
```

The module ships its entities (`ai_conversations`, `ai_messages`), not migrations: generate them
with the app's (`alepha db migrations create`), as for every `alepha/api/*` module. With several
`$ai`s in the app, a chat names the one it talks to (`assistant`).

### Budget, rate and retention: the `api.ai` parameter

Runtime settings, editable by an operator without a redeploy (`alepha/api/parameters`):

| key                 | default | meaning                                                                      |
| ------------------- | ------- | ---------------------------------------------------------------------------- |
| `budgetTokens`      | unset   | tokens (input plus output) one user may spend per window; unset is no budget |
| `budgetWindowHours` | 24      | the budget window, sliding, in hours                                         |
| `turnsPerMinute`    | 20      | turns one user may start per minute (`$rateLimit`)                           |
| `retentionDays`     | unset   | days a conversation is kept after its last activity; unset is keep           |

The budget is checked before a turn from the stored token counts, so a turn can overshoot by its
own size. Retention is a daily `$job` that reads the parameter at every tick. Page data and tool
results live in the messages, so retention is a privacy setting as much as a storage one.

## The client side: `@alepha/ui/ai`

```tsx
import { Button } from "@alepha/ui";
import { AiChat, useAiContext } from "@alepha/ui/ai";
import { useForm } from "alepha/react/form";
import { useState } from "react";

// `InvoicePageProps`, `invoiceSchema` and `save` are your own page's.
const InvoicePage = (props: InvoicePageProps) => {
  const form = useForm({ schema: invoiceSchema, handler: save });
  // What the page shows, and the form the assistant may fill (never submit).
  useAiContext({ page: "invoice", data: props.invoice, form });
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Ask</Button>
      <AiChat
        mode="auto"
        open={open}
        onOpenChange={setOpen}
        invalidates={[["invoices"]]}
      />
    </>
  );
};
```

- `<AiChat />` holds the conversation: streamed markdown replies, the conversation history, and a
  confirmation card for every mutation, which shows the input the server stored and answers with
  the call id only.
- `mode` says where it sits. `drawer` (the default) is a modal drawer over a dimmed page. `dock`
  is a panel beside the page, with no backdrop: the page stays readable and usable, and a link in a
  reply changes the page next to the conversation. Its edge drags to resize, and it minimizes into
  a pill that still shows an action waiting for approval. `auto` docks from 1024px up and uses the
  drawer below. A dock renders into an `<AiChatDockSlot />` placed in your layout, which narrows
  the page to make room (`AppShell` takes one as `aside={<AiChatDockSlot />}`); without a slot it
  floats over the page's right edge.
- `<AiChatPanel />` is the conversation without a container, for a layout that holds it itself.
- `useAiChat()` is the same state and actions without the UI: `items`, `streaming`, `pending`,
  `send`, `approve`, `deny`, `open`, each resolving a `RunResult`. `invalidates` lists the query
  keys to refresh after a turn ran a tool, so the page shows what the assistant changed.
- `useAiContext({ page, data, form })` declares what a page shows. Every turn carries the current
  route and the innermost declared context.
- Client tools run in the browser and the turn resumes with their result on its own: `navigate`
  (by page name, through the typed router) and `fillForm` (only the form a page offered, never
  submitted). Declare them on your `$ai` with `aiNavigateTool` and `aiFillFormTool` from
  `alepha/ai`; your own go in `useAiChat({ clientTools })`.

The browser opens a `$sse` through `useClient()` like any action: a refusal rejects with its typed
error, the events arrive as they are sent.

## One build, Node and Workers

`apps/examples/ai` is a notes app with one read action, one write action and an assistant, built
once with `alepha build --runtime node,workerd`:

- on Workers, `AlephaAiCloudflare` answers through the `env.AI` binding, which the build
  declares in `wrangler.jsonc` (and the Lore deploy uploads);
- in Docker (`alepha image`), the same build runs on Node, and `AlephaAiOpenai` reaches the same
  Workers AI models over REST with `AI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1`
  and a Cloudflare API token as `AI_API_KEY`.

Only the environment differs. Its e2e runs the Node build against a scripted `MemoryAiProvider`:
ask, confirm the write, see the page change.

## Testing

`MemoryAiProvider` is the default under test. Script one response per model call:

```typescript check
import { Alepha } from "alepha";
import { AlephaAi, MemoryAiProvider } from "alepha/ai";

const alepha = Alepha.create().with(AlephaAi);
const ai = alepha.inject(MemoryAiProvider);
ai.script([{ type: "tool_call", id: "c1", name: "list", input: {} }]);
ai.script([{ type: "text", text: "You have two invoices." }]);
```

`ai.requests` keeps every request, so a spec asserts what the model would have been sent.
