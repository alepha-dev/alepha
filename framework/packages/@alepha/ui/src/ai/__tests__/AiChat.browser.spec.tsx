import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { type ComponentType, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AiChat, type AiChatProps } from "../AiChat.tsx";
import type { AiChatConfirmCardProps } from "../AiChatConfirmCard.tsx";
import { AiChatDockSlot } from "../AiChatDockSlot.tsx";
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

/**
 * A layout with a dock column and the app's own open button, the state
 * `AiChat` reports its minimize through.
 */
const DockLayout = (props: Partial<AiChatProps>) => {
  const [open, setOpen] = useState(true);
  return (
    <div data-testid="layout" style={{ display: "flex" }}>
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          Ask
        </button>
        <span data-testid="open-state">{String(open)}</span>
      </main>
      <AiChatDockSlot />
      <AiChat {...props} mode="dock" open={open} onOpenChange={setOpen} />
    </div>
  );
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

  const mount = async (
    setup: (links: Links) => void = () => {},
    chatProps: Partial<AiChatProps> = {},
    Layout?: ComponentType<Partial<AiChatProps>>,
  ) => {
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
        {Layout ? (
          <Layout {...chatProps} />
        ) : (
          <AiChat open onOpenChange={() => {}} {...chatProps} />
        )}
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

  it("keeps what was typed when the drawer re-renders before Send", async () => {
    const { links, view } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        { type: "text", text: "Done." },
        { type: "end", reason: "stop" },
      ]);
    });
    const box = await waitFor(() => {
      const found = document.querySelector("[data-testid='ai-chat'] textarea");
      expect(found).toBeTruthy();
      return found as HTMLTextAreaElement;
    });

    fireEvent.change(box, { target: { value: "add a note" } });
    // Any re-render of the drawer, here a new prop: the history fetch
    // settling did it in the AI example's e2e, between the fill and Send.
    view.rerender(
      <AlephaContext.Provider value={alepha!}>
        <InvoicePage onForm={() => {}} />
        <AiChat open onOpenChange={() => {}} title="Assistant" />
      </AlephaContext.Provider>,
    );
    fireEvent.click(view.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(links.bodies("chat").map((body) => body.message)).toEqual([
        "add a note",
      ]),
    );
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

    fireEvent.click(view.getByRole("button", { name: "History" }));
    fireEvent.click(
      await view.findByRole("button", { name: /Earlier question/ }),
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
    // The generic card lists the fields, the input parts flattened away.
    const fields = view.getByTestId("ai-chat-confirm-fields");
    expect(fields.textContent).toContain("amount");
    expect(fields.textContent).toContain("120");
    expect(fields.textContent).not.toContain("body");

    fireEvent.click(view.getByRole("button", { name: "Approve" }));
    await view.findByText("Created.");
    expect(links.calls.filter((c) => c.name === "resume")).toEqual([
      {
        name: "resume",
        input: {
          params: { id: conversationId },
          body: {
            callId: "c1",
            decision: "approve",
            // The page context rides on the resume, for the server's `allow`.
            context: expect.objectContaining({ route: "/" }),
          },
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
        {
          type: "tool_result",
          callId: "c2",
          name: "deleteAll",
          isError: true,
        },
        { type: "text", text: "Not done." },
        { type: "end", reason: "stop" },
      ]);
    });
    await say("delete everything");
    fireEvent.click(await view.findByRole("button", { name: "Deny" }));
    await view.findByText("Not done.");
    expect(links.bodies("resume")).toEqual([
      {
        callId: "c2",
        decision: "deny",
        context: expect.objectContaining({ route: "/" }),
      },
    ]);
    // A denial reads as cancelled, not as a failure.
    expect(view.getByTestId("ai-chat-tool").textContent).toBe(
      "deleteAll cancelled",
    );
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
        context: expect.objectContaining({ route: "/" }),
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
  it("renders an app's own confirmation card for a tool, with the same callbacks", async () => {
    const BookingCard = (props: AiChatConfirmCardProps) => (
      <div data-testid="booking-card">
        Court {String((props.pending.input.body as any)?.court)}
        <button type="button" onClick={() => props.onApprove()}>
          Book it
        </button>
      </div>
    );
    const { links, view, say } = await mount(
      (l) => {
        l.streams.push([
          { type: "conversation", conversationId },
          {
            type: "confirm",
            callId: "c3",
            name: "createBooking",
            input: { body: { court: 4 } },
          },
          { type: "end", reason: "paused" },
        ]);
        l.streams.push([
          { type: "text", text: "Booked." },
          { type: "end", reason: "stop" },
        ]);
      },
      { confirmCards: { createBooking: BookingCard } },
    );
    await say("book court 4");
    const card = await view.findByTestId("booking-card");
    expect(card.textContent).toContain("Court 4");
    expect(view.queryByTestId("ai-chat-confirm")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Book it" }));
    await view.findByText("Booked.");
    expect(links.bodies("resume")).toEqual([
      {
        callId: "c3",
        decision: "approve",
        context: expect.objectContaining({ route: "/" }),
      },
    ]);
  });

  it("renders the reply's links through renderLink", async () => {
    const { view, say } = await mount(
      (l) => {
        l.streams.push([
          { type: "conversation", conversationId },
          {
            type: "text",
            text: "See [the planning](/admin/planning) or [nowhere](/admin/nope).",
          },
          { type: "end", reason: "stop" },
        ]);
      },
      {
        renderLink: ({ href, children }) =>
          href === "/admin/planning" ? (
            <a data-testid="known-link" href={href}>
              {children}
            </a>
          ) : (
            children
          ),
      },
    );
    await say("where?");
    const link = await view.findByTestId("known-link");
    expect(link.textContent).toBe("the planning");
    expect(view.getByText(/nowhere/).closest("a")).toBeNull();
  });

  it("starts from a suggestion, names tool steps through toolLabel, and sends on Enter", async () => {
    const { links, view } = await mount(
      (l) => {
        l.streams.push([
          { type: "conversation", conversationId },
          { type: "tool_call", callId: "t1", name: "findNotes", input: {} },
          { type: "tool_result", callId: "t1", name: "findNotes" },
          { type: "text", text: "Two notes." },
          { type: "end", reason: "stop" },
        ]);
        l.streams.push([
          { type: "text", text: "Done." },
          { type: "end", reason: "stop" },
        ]);
      },
      {
        suggestions: [{ label: "My notes", prompt: "list my notes" }],
        toolLabel: (name, state) =>
          name === "findNotes" && state === "done"
            ? "Searched notes"
            : undefined,
      },
    );

    fireEvent.click(await view.findByRole("button", { name: "My notes" }));
    await view.findByText("Two notes.");
    expect(links.bodies("chat")[0].message).toBe("list my notes");
    expect(view.getByTestId("ai-chat-tool").textContent).toBe("Searched notes");
    expect(view.queryByTestId("ai-chat-empty")).toBeNull();

    const box = document.querySelector(
      "[data-testid='ai-chat'] textarea",
    ) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "thanks" } });
    // Shift+Enter is a new line, not a send.
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(links.bodies("chat")).toHaveLength(1);
    fireEvent.keyDown(box, { key: "Enter" });
    await view.findByText("Done.");
    expect(links.bodies("chat")[1].message).toBe("thanks");
    expect(box.value).toBe("");
  });

  it("locks the composer while a confirmation waits", async () => {
    const { view, say } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        {
          type: "confirm",
          callId: "c1",
          name: "createNote",
          input: { body: { title: "x" } },
        },
        { type: "end", reason: "paused" },
      ]);
    });
    await say("add a note");
    await view.findByTestId("ai-chat-confirm");
    const box = document.querySelector(
      "[data-testid='ai-chat'] textarea",
    ) as HTMLTextAreaElement;
    expect(box.disabled).toBe(true);
    expect(box.placeholder).toBe("Confirm or cancel the card to go on");
  });

  it("docks beside the page without a backdrop, minimizes into a pill that shows a waiting action, and restores", async () => {
    const { view, say } = await mount(
      (l) => {
        l.streams.push([
          { type: "conversation", conversationId },
          {
            type: "confirm",
            callId: "c1",
            name: "createNote",
            input: { body: { title: "x" } },
          },
          { type: "end", reason: "paused" },
        ]);
      },
      {},
      DockLayout,
    );

    // In the layout's slot, a sibling of the page, and not a dialog.
    const dock = await view.findByTestId("ai-chat-dock");
    expect(dock.parentElement?.getAttribute("data-slot")).toBe("ai-chat-dock");
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-slot='drawer-overlay']")).toBeNull();

    await say("add a note");
    await view.findByTestId("ai-chat-confirm");

    fireEvent.click(view.getByRole("button", { name: "Minimize" }));
    expect(view.queryByTestId("ai-chat-dock")).toBeNull();
    expect(view.getByTestId("open-state").textContent).toBe("false");
    const pill = view.getByTestId("ai-chat-launcher");
    expect(pill.textContent).toContain("Action to approve");

    // The app's own button brings it back, conversation and card included.
    fireEvent.click(view.getByRole("button", { name: "Ask" }));
    await view.findByTestId("ai-chat-dock");
    expect(view.queryByTestId("ai-chat-launcher")).toBeNull();
    expect(view.getByTestId("ai-chat-confirm")).toBeTruthy();

    // Closing ends with no pill left behind; the pill restores too.
    fireEvent.click(view.getByRole("button", { name: "Minimize" }));
    fireEvent.click(view.getByTestId("ai-chat-launcher"));
    await view.findByTestId("ai-chat-dock");
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    expect(view.queryByTestId("ai-chat-dock")).toBeNull();
    expect(view.queryByTestId("ai-chat-launcher")).toBeNull();
  });
});
