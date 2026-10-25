import type {
  AiController,
  AiMessageResource,
  AiPendingCallResource,
  AiStreamEvent,
} from "alepha/api/ai";
import { type RunResult, useAction, useAlepha, useClient } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useCallback, useMemo, useRef, useState } from "react";

import { aiContextAtom } from "./aiContextAtom.ts";
import { AiFormRegistry } from "./AiFormRegistry.ts";

/**
 * The state and actions of an assistant conversation, without any UI: what
 * `<AiChat />` is built on, for an app that wants its own.
 *
 * - `send(message)` starts a turn in the current conversation (a new one
 *   first), with the current route and the innermost `useAiContext()`.
 * - A turn that pauses on a mutation sets `pending`; `approve()` or `deny()`
 *   answers it with the call id only, never the input: the server runs the
 *   input it stored.
 * - A turn that pauses on a client tool runs it here and resumes with its
 *   result, on its own: `navigate` (by page name, through the typed router),
 *   `fillForm` (only a form offered with `useAiContext({ form })`, never
 *   submitted), and any `clientTools` the app passes.
 * - `open(id)` loads a stored conversation; `open()` starts a new one.
 *
 * Every action resolves a `RunResult` and never rejects, as `useAction` does.
 */
export const useAiChat = (options: UseAiChatOptions = {}): UseAiChat => {
  const api = useClient<AiController>();
  const alepha = useAlepha();
  const forms = useMemo(() => AiFormRegistry.of(alepha), [alepha]);
  const router = useRouter<any>();
  const [conversationId, setConversationId] = useState<string | undefined>(
    options.conversationId,
  );
  const [items, setItems] = useState<AiChatItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [activity, setActivity] = useState<string | undefined>();
  const [pending, setPending] = useState<AiPendingCallResource | undefined>();
  const [error, setError] = useState<string | undefined>();
  // The id the next request uses, ahead of the render that shows it.
  const idRef = useRef<string | undefined>(options.conversationId);
  const counter = useRef(0);

  const push = useCallback((item: Omit<AiChatItem, "id">) => {
    counter.current += 1;
    const id = `local-${counter.current}`;
    setItems((current) => [...current, { id, ...item }]);
  }, []);

  /**
   * Run a client tool the turn paused on, and return its result. A failure
   * is a result too: the model reads it and recovers.
   */
  const runClientTool = useCallback(
    async (name: string, input: Record<string, unknown>) => {
      try {
        if (options.clientTools?.[name]) {
          return { ok: true, result: await options.clientTools[name](input) };
        }
        if (name === "navigate") {
          await router.push(String(input.page), {
            params: (input.params as Record<string, string>) ?? {},
          });
          return { ok: true, page: input.page };
        }
        if (name === "fillForm") {
          const stack = alepha.store.get(aiContextAtom) ?? [];
          const formId = stack.findLast((it) => it.formId)?.formId;
          const form = formId ? forms.get(formId) : undefined;
          if (!form) {
            return {
              ok: false,
              error: "No form on this page accepts being filled.",
            };
          }
          return {
            ok: true,
            ...forms.fill(
              form,
              (input.values as Record<string, unknown>) ?? {},
            ),
            submitted: false,
          };
        }
        return { ok: false, error: `Unknown client tool '${name}'.` };
      } catch (cause) {
        return {
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
    [alepha, forms, router, options.clientTools],
  );

  /**
   * Read one stream to its end, then follow a client-tool pause with a
   * resume, until the turn stops or waits on the user.
   */
  const consume = useCallback(
    async (
      first: AsyncIterable<AiStreamEvent>,
      signal: AbortSignal,
    ): Promise<void> => {
      let stream: AsyncIterable<AiStreamEvent> | undefined = first;
      while (stream) {
        let text = "";
        let clientCall: AiPendingCallResource | undefined;
        for await (const event of stream) {
          if (event.type === "conversation" && event.conversationId) {
            idRef.current = event.conversationId;
            setConversationId(event.conversationId);
          } else if (event.type === "text" && event.text) {
            text += event.text;
            setStreaming(text);
          } else if (event.type === "tool_call") {
            setActivity(event.name);
          } else if (event.type === "tool_result") {
            setActivity(undefined);
            push({
              role: "tool",
              content: "",
              name: event.name,
              isError: event.isError,
            });
          } else if (event.type === "confirm") {
            setPending({
              callId: event.callId ?? "",
              name: event.name ?? "",
              input: event.input ?? {},
              kind: "confirm",
            });
          } else if (event.type === "client_tool") {
            clientCall = {
              callId: event.callId ?? "",
              name: event.name ?? "",
              input: event.input ?? {},
              kind: "client_tool",
            };
          } else if (event.type === "error") {
            setError(event.message ?? event.name ?? "The assistant failed");
          }
          if (text && (event.type === "tool_call" || event.type === "end")) {
            push({ role: "assistant", content: text });
            text = "";
            setStreaming("");
          }
        }
        setActivity(undefined);
        stream = undefined;
        if (clientCall && idRef.current) {
          const result = await runClientTool(clientCall.name, clientCall.input);
          stream = await api.resume(
            {
              params: { id: idRef.current },
              body: { callId: clientCall.callId, result },
            },
            { request: { signal } },
          );
        }
      }
    },
    [api, push, runClientTool],
  );

  const send = useAction<[message: string]>(
    {
      handler: async ({ signal }, message) => {
        setError(undefined);
        push({ role: "user", content: message });
        const stack = alepha.store.get(aiContextAtom) ?? [];
        const innermost = stack[stack.length - 1];
        const stream = await api.chat(
          {
            body: {
              conversationId: idRef.current,
              message,
              assistant: options.assistant,
              context: {
                route: router.pathname,
                page: innermost?.page,
                data: innermost?.data,
              },
            },
          },
          { request: { signal } },
        );
        await consume(stream, signal);
      },
      onError: (cause) => setError(cause.message),
    },
    [api, alepha, consume, options.assistant, push, router],
  );

  const answer = useAction<[decision: "approve" | "deny"]>(
    {
      handler: async ({ signal }, decision) => {
        if (!pending || !idRef.current) {
          return;
        }
        setError(undefined);
        const callId = pending.callId;
        setPending(undefined);
        const stream = await api.resume(
          { params: { id: idRef.current }, body: { callId, decision } },
          { request: { signal } },
        );
        await consume(stream, signal);
      },
      onError: (cause) => setError(cause.message),
    },
    [api, consume, pending],
  );

  const open = useAction<[id?: string]>(
    {
      handler: async (_ctx, id) => {
        setError(undefined);
        setStreaming("");
        setPending(undefined);
        idRef.current = id;
        setConversationId(id);
        if (!id) {
          setItems([]);
          return;
        }
        const detail = await api.getConversation({ params: { id } });
        setItems(
          detail.messages.map((message: AiMessageResource) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            name: message.name,
            isError: message.isError,
          })),
        );
        setPending(detail.conversation.pendingCall);
      },
      onError: (cause) => setError(cause.message),
    },
    [api],
  );

  return {
    conversationId,
    items,
    streaming,
    activity,
    pending,
    error,
    loading: send.loading || answer.loading || open.loading,
    send: (message) => send.run(message),
    approve: () => answer.run("approve"),
    deny: () => answer.run("deny"),
    open: (id) => open.run(id),
  };
};

// ---------------------------------------------------------------------------------------------------------------------

export interface UseAiChatOptions {
  /**
   * The `$ai` to talk to, when the app declares several.
   */
  assistant?: string;
  /**
   * A stored conversation to continue.
   */
  conversationId?: string;
  /**
   * The app's own client tools, by name, beside `navigate` and `fillForm`.
   * The result goes back to the model.
   */
  clientTools?: Record<string, (input: Record<string, unknown>) => unknown>;
}

/**
 * One line of the conversation as shown.
 */
export interface AiChatItem {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  /**
   * The tool, on a `tool` line.
   */
  name?: string;
  isError?: boolean;
}

export interface UseAiChat {
  conversationId?: string;
  items: AiChatItem[];
  /**
   * The assistant's reply as it streams, before it lands in `items`.
   */
  streaming: string;
  /**
   * The tool running right now, for a progress line.
   */
  activity?: string;
  /**
   * The mutation waiting for the user, with the input the server stored.
   */
  pending?: AiPendingCallResource;
  error?: string;
  loading: boolean;
  send: (message: string) => Promise<RunResult<void>>;
  approve: () => Promise<RunResult<void>>;
  deny: () => Promise<RunResult<void>>;
  open: (id?: string) => Promise<RunResult<void>>;
}
