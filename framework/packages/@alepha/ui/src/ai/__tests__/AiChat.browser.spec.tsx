import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AiChat } from "../AiChat.tsx";
import { useAiContext } from "../useAiContext.ts";

const conversationId = "00000000-0000-4000-8000-000000000041";

/**
 * Stands in for `alepha/api/ai`: each `chat` / `resume` call replays the next
 * queued event list as a stream, and every call is recorded.
 */
class Links extends LinkProvider {
  public calls: Array<{ name: string; input: any }> = [];
  public streams: Array<Array<Record<string, unknown>>> = [];
  public conversations: Array<Record<string, unknown>> = [];
  public detail: Record<string, unknown> | undefined;

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, name: string) => {
          const action: any = async (input: any) => {
            this.calls.push({ name, input });
            if (name === "chat" || name === "resume") {
              const events = this.streams.shift() ?? [];
              return (async function* () {
                for (const event of events) {
                  yield event;
                }
              })();
            }
            if (name === "listConversations") {
              return this.conversations;
            }
            if (name === "getConversation") {
              return this.detail;
            }
            return undefined;
          };
          action.can = () => true;
          return action;
        },
      },
    );
  }

  public bodies(name: string) {
    return this.calls.filter((c) => c.name === name).map((c) => c.input.body);
  }
}

const invoiceFormSchema = z.object({
  amount: z.number().optional(),
  note: z.text().optional(),
});

interface InvoicePageProps {
  onForm: (form: any) => void;
}

/**
 * A page that declares its context and offers its form to `fillForm`.
 */
const InvoicePage = (props: InvoicePageProps) => {
  const form = useForm({ schema: invoiceFormSchema, handler: () => {} });
  props.onForm(form);
  useAiContext({ page: "invoice", data: { id: 7 }, form });
  return null;
};

describe("AiChat", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (setup: (links: Links) => void = () => {}) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    class Pages {
      invoices = $page({
        name: "invoices",
        path: "/invoices",
        component: () => "invoices",
      });
    }
    alepha.with(Pages);
    const links = alepha.inject(Links);
    setup(links);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    let form: any;
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <InvoicePage onForm={(f) => (form = f)} />
        <AiChat open onOpenChange={() => {}} />
      </AlephaContext.Provider>,
    );
    const say = async (text: string) => {
      const box = await waitFor(() => {
        const found = document.querySelector(
          "[data-testid='ai-chat'] textarea",
        );
        expect(found).toBeTruthy();
        return found as HTMLTextAreaElement;
      });
      fireEvent.change(box, { target: { value: text } });
      fireEvent.click(view.getByRole("button", { name: "Send" }));
    };
    return { links, view, say, form: () => form };
  };

  it("streams the reply as markdown and sends the route and the page context", async () => {
    const { links, view, say } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        { type: "text", text: "Invoice **7** " },
        { type: "text", text: "is late." },
        { type: "end", reason: "stop" },
      ]);
    });

    await say("why late?");

    await waitFor(() =>
      expect(view.getByTestId("ai-chat-assistant").textContent).toBe(
        "Invoice 7 is late.",
      ),
    );
    expect(view.getByTestId("ai-chat-user").textContent).toBe("why late?");
    expect(links.bodies("chat")).toEqual([
      {
        conversationId: undefined,
        message: "why late?",
        assistant: undefined,
        context: { route: "/", page: "invoice", data: { id: 7 } },
      },
    ]);
  });

  it("continues the conversation it is in and keeps the history", async () => {
    const { links, view, say } = await mount((l) => {
      l.conversations = [
        {
          id: conversationId,
          createdAt: "2026-10-25T10:00:00.000Z",
          updatedAt: "2026-10-25T10:00:00.000Z",
          title: "Earlier question",
        },
      ];
      l.detail = {
        conversation: l.conversations[0],
        messages: [
          {
            id: "m1",
            createdAt: "2026-10-25T10:00:00.000Z",
            role: "user",
            content: "Earlier question",
          },
          {
            id: "m2",
            createdAt: "2026-10-25T10:00:01.000Z",
            role: "assistant",
            content: "Earlier answer",
          },
        ],
      };
      l.streams.push([
        { type: "conversation", conversationId },
        { type: "text", text: "Again." },
        { type: "end", reason: "stop" },
      ]);
    });

    fireEvent.click(
      await view.findByRole("button", { name: "Earlier question" }),
    );
    await view.findByText("Earlier answer");

    await say("and now?");
    await view.findByText("Again.");
    expect(links.bodies("chat")[0].conversationId).toBe(conversationId);
    expect(
      view.getAllByTestId("ai-chat-user").map((it) => it.textContent),
    ).toEqual(["Earlier question", "and now?"]);
  });

  it("asks before a mutation, then approves by call id only", async () => {
    const { links, view, say } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        {
          type: "confirm",
          callId: "c1",
          name: "createInvoice",
          input: { body: { amount: 120 } },
        },
        { type: "end", reason: "paused" },
      ]);
      l.streams.push([
        { type: "conversation", conversationId },
        {
          type: "tool_result",
          callId: "c1",
          name: "createInvoice",
          isError: false,
        },
        { type: "text", text: "Created." },
        { type: "end", reason: "stop" },
      ]);
    });

    await say("bill 120");
    const card = await view.findByTestId("ai-chat-confirm");
    expect(card.textContent).toContain("Run createInvoice?");
    expect(card.textContent).toContain('"amount": 120');

    fireEvent.click(view.getByRole("button", { name: "Approve" }));
    await view.findByText("Created.");
    expect(links.calls.filter((c) => c.name === "resume")).toEqual([
      {
        name: "resume",
        input: {
          params: { id: conversationId },
          body: { callId: "c1", decision: "approve" },
        },
      },
    ]);
    expect(view.queryByTestId("ai-chat-confirm")).toBeNull();
  });

  it("denies a mutation by call id only", async () => {
    const { links, view, say } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        { type: "confirm", callId: "c2", name: "deleteAll", input: {} },
        { type: "end", reason: "paused" },
      ]);
      l.streams.push([
        { type: "text", text: "Not done." },
        { type: "end", reason: "stop" },
      ]);
    });
    await say("delete everything");
    fireEvent.click(await view.findByRole("button", { name: "Deny" }));
    await view.findByText("Not done.");
    expect(links.bodies("resume")).toEqual([
      { callId: "c2", decision: "deny" },
    ]);
  });

  it("fills the offered form without submitting, then resumes with what it filled", async () => {
    const { links, view, say, form } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        {
          type: "client_tool",
          callId: "f1",
          name: "fillForm",
          input: { values: { amount: 42, note: "late fee", password: "x" } },
        },
        { type: "end", reason: "paused" },
      ]);
      l.streams.push([
        { type: "text", text: "Filled, please review." },
        { type: "end", reason: "stop" },
      ]);
    });

    await say("fill it");
    await view.findByText("Filled, please review.");

    expect(form().currentValues).toMatchObject({
      amount: 42,
      note: "late fee",
    });
    expect(links.bodies("resume")).toEqual([
      {
        callId: "f1",
        result: {
          ok: true,
          filled: ["amount", "note"],
          ignored: ["password"],
          submitted: false,
        },
      },
    ]);
  });

  it("navigates by page name through the typed router, and reports an unknown page", async () => {
    const { links, view, say } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        {
          type: "client_tool",
          callId: "n1",
          name: "navigate",
          input: { page: "nowhere" },
        },
        { type: "end", reason: "paused" },
      ]);
      l.streams.push([
        { type: "text", text: "That page does not exist." },
        { type: "end", reason: "stop" },
      ]);
    });

    await say("go");
    await view.findByText("That page does not exist.");
    const [body] = links.bodies("resume");
    expect(body.callId).toBe("n1");
    expect(body.result.ok).toBe(false);
  });

  it("shows a refusal before the stream as an error", async () => {
    const { view, say } = await mount((l) => {
      l.client = () =>
        new Proxy(
          {},
          {
            get: (_t, name: string) => {
              const action: any = async () => {
                if (name === "chat") {
                  throw new Error("AI budget reached: 120 of 100 tokens");
                }
                return [];
              };
              action.can = () => true;
              return action;
            },
          },
        );
    });
    await say("hi");
    expect((await view.findByTestId("ai-chat-error")).textContent).toContain(
      "AI budget reached",
    );
  });
});
