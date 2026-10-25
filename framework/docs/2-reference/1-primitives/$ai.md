# $ai

## Import

```typescript
import { $ai } from "alepha/ai";
```

## Overview

Declares an assistant: a system prompt, the `$action`s it may call, and a
tool loop that runs them as the signed-in user.

- **Tools are `$action`s.** Each becomes a tool named after the action,
  described by its `description`, taking `{ params, query, body }` for the
  parts the action declares. It runs through `action.run(input, { user })`,
  so the action's own `use: [$secure(...)]` decides, and the assistant can
  never do more than the user could. A refusal, a validation error or a
  thrown error goes back to the model as a tool error.
- **Mutations wait for the user.** A call to a non-GET action (or whatever
  `confirm` says) pauses the turn with a `confirm` event; a client tool
  (see `clientTool`) pauses with a `client_tool` event.
- **Re-entrant.** The loop's whole state is the message list. A pause ends
  the stream; resuming is a new `stream()` with the stored messages and
  `resume: { callId, decision }` or `{ callId, result }`. An approved call
  runs the input stored in the messages, never input sent back by a
  browser. Nothing lives in memory between requests, which is the shape
  that works on Workers.
- **Page context** rides on the latest user message, capped at 8 KB, never
  in the system prompt, which stays cacheable.

## Options

| Option      | Type                                                          | Required | Description                                                            |
| ----------- | ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `name`      | `string`                                                      | No       | Name of the assistant, in logs                                         |
| `model`     | `string`                                                      | No       | Model id for this assistant                                            |
| `system`    | `string \| ((ctx: { user?: UserAccountToken }) =&gt; string)` | Yes      | The system prompt, or a function of the user                           |
| `tools`     | `Array&lt;ActionPrimitive&lt;any&gt; \| AiClientTool&gt;`     | No       | The tools: `$action`s, and client tools from `clientTool`.             |
| `confirm`   | `Object`                                                      | No       | Whether a call to this action waits for the user's approval            |
| `maxSteps`  | `number`                                                      | No       | Model calls per turn before the loop stops with `end: length`.         |
| `timeout`   | `DurationLike`                                                | No       | Wall-clock bound on one `stream()`, aborting the model call in flight. |
| `maxTokens` | `number`                                                      | No       | Upper bound on the tokens of each model response.                      |

## Examples

```ts
class Support {
  invoices = $inject(InvoiceApi);

  assistant = $ai({
    system: "You help with invoices. Be brief.",
    tools: [this.invoices.list, this.invoices.create],
  });

  async answer(messages: AiMessage[], user: UserAccountToken) {
    for await (const event of this.assistant.stream({ messages, user })) {
      // persist `message` events, forward `text`, stop on a pause
    }
  }
}
```
