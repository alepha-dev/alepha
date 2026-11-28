import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks, expectAccessible } from "alepha/testing/react";
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
                  // A `wait` holds the stream, so a spec sees a call running.
                  if (event.wait instanceof Promise) {
                    await event.wait;
                    continue;
                  }
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

/**
 * The same, floating over the page's corner instead (#Q4269): no slot.
 */
const FloatLayout = (props: Partial<AiChatProps>) => {
  const [open, setOpen] = useState(true);
  const [clicks, setClicks] = useState(0);
  return (
    <div data-testid="layout">
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          Ask
        </button>
        <button type="button" onClick={() => setClicks((n) => n + 1)}>
          Page action
        </button>
        <span data-testid="open-state">{String(open)}</span>
        <span data-testid="page-clicks">{clicks}</span>
      </main>
      <AiChat {...props} mode="floating" open={open} onOpenChange={setOpen} />
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
    // axe: the chat drawer with a streamed reply (#Q3338).
    await expectAccessible();
    expect(links.bodies("chat")).toEqual([
      {
        conversationId: undefined,
        message: "why late?",
        assistant: undefined,
        context: { route: "/", page: "invoice", data: { id: 7 } },
      },
    ]);
  });

  it("says when a reply was cut at the length limit, and continues on request", async () => {
    const { links, view, say } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        { type: "text", text: "Folio 1, folio 2, **" },
        { type: "end", reason: "length" },
      ]);
      l.streams.push([
        { type: "text", text: "folio 3." },
        { type: "end", reason: "stop" },
      ]);
    });

    await say("list the folios");

    const notice = await waitFor(() => view.getByTestId("ai-chat-cut"));
    expect(notice.textContent).toContain("This answer was cut short");
    // The cut text stays, and the notice belongs to that reply.
    const cut = view.getByTestId("ai-chat-assistant");
    expect(cut.textContent).toContain("Folio 1, folio 2,");
    expect(cut.contains(notice)).toBe(true);

    fireEvent.click(within(notice).getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(view.getAllByTestId("ai-chat-assistant").at(-1)?.textContent).toBe(
        "folio 3.",
      ),
    );
    expect(links.bodies("chat").map((body: any) => body.message)).toEqual([
      "list the folios",
      "Continue",
    ]);
    // The older reply keeps its notice and loses its button: continuing now
    // would no longer mean that answer. A finished reply carries none.
    const notices = view.getAllByTestId("ai-chat-cut");
    expect(notices).toHaveLength(1);
    expect(within(notices[0]!).queryByRole("button")).toBeNull();
  });

  it("marks a turn cut before any text, so an empty reply is not silence", async () => {
    const { view, say } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        { type: "end", reason: "length" },
      ]);
    });

    await say("list everything");

    await waitFor(() => expect(view.getByTestId("ai-chat-cut")).toBeTruthy());
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
    // A long input scrolls inside the card, and the answers stay outside the
    // scroll, always on screen.
    const body = view.getByTestId("ai-chat-confirm-body");
    expect(body.className).toContain("max-h-80");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.contains(view.getByRole("button", { name: "Approve" }))).toBe(
      false,
    );

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

  it("tells onToolsRan which tools succeeded once the stream ends", async () => {
    const ran: string[][] = [];
    const { view, say } = await mount(
      (l) => {
        l.streams.push([
          { type: "conversation", conversationId },
          {
            type: "confirm",
            callId: "c4",
            name: "createInvoice",
            input: { body: { amount: 5 } },
          },
          { type: "end", reason: "paused" },
        ]);
        l.streams.push([
          {
            type: "tool_result",
            callId: "c4",
            name: "createInvoice",
            isError: false,
          },
          {
            type: "tool_result",
            callId: "c5",
            name: "listInvoices",
            isError: true,
          },
          { type: "text", text: "Billed." },
          { type: "end", reason: "stop" },
        ]);
      },
      { onToolsRan: (names) => ran.push(names) },
    );
    await say("bill 5");
    fireEvent.click(await view.findByRole("button", { name: "Approve" }));
    await view.findByText("Billed.");
    // The failed one is left out: only a success changed anything.
    expect(ran).toEqual([["createInvoice"]]);
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
    expect(view.getByTestId("ai-chat-tool-trace-line").textContent).toBe(
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
    expect(view.getByTestId("ai-chat-tool-trace-line").textContent).toBe(
      "Searched notes",
    );
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

  it("folds a run of tool calls into one line that opens on every step, and names only the call in flight", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { view, say } = await mount(
      (l) => {
        l.streams.push([
          { type: "conversation", conversationId },
          ...["s1", "s2", "s3", "s4"].flatMap((callId) => [
            { type: "tool_call", callId, name: "search", input: {} },
            { type: "tool_result", callId, name: "search" },
          ]),
          { type: "tool_call", callId: "q1", name: "quest_get", input: {} },
          { wait: held },
          { type: "tool_result", callId: "q1", name: "quest_get" },
          { type: "text", text: "Found it." },
          { type: "end", reason: "stop" },
        ]);
      },
      {
        toolLabel: (name, state) =>
          name === "search"
            ? "Searched the project"
            : state === "running"
              ? "Reading a quest"
              : "Read a quest",
        toolSummary: (tools) =>
          `Searched ${tools.filter((t) => t.name === "search").length} times, read a quest`,
      },
    );
    await say("find it");

    // In flight: one line, naming the running call only.
    await waitFor(() =>
      expect(view.getByTestId("ai-chat-tool-trace-line").textContent).toBe(
        "Reading a quest",
      ),
    );
    expect(view.getAllByTestId("ai-chat-tool-trace")).toHaveLength(1);
    expect(view.queryAllByTestId("ai-chat-tool")).toHaveLength(0);

    release();
    await view.findByText("Found it.");
    expect(view.getAllByTestId("ai-chat-tool-trace")).toHaveLength(1);
    const line = view.getByTestId("ai-chat-tool-trace-line");
    expect(line.textContent).toBe("Searched 4 times, read a quest");

    fireEvent.click(line);
    const steps = view.getAllByTestId("ai-chat-tool");
    expect(steps.map((step) => step.textContent)).toEqual([
      "Searched the projectsearch",
      "Searched the projectsearch",
      "Searched the projectsearch",
      "Searched the projectsearch",
      "Read a questquest_get",
    ]);
  });

  it("says how many tools ran when the app gives no summary", async () => {
    const { view, say } = await mount((l) => {
      l.streams.push([
        { type: "conversation", conversationId },
        { type: "tool_call", callId: "a", name: "findNotes", input: {} },
        { type: "tool_result", callId: "a", name: "findNotes" },
        { type: "tool_call", callId: "b", name: "readNote", input: {} },
        { type: "tool_result", callId: "b", name: "readNote", isError: true },
        { type: "text", text: "Partly." },
        { type: "end", reason: "stop" },
      ]);
    });
    await say("notes");
    await view.findByText("Partly.");
    expect(view.getByTestId("ai-chat-tool-trace-line").textContent).toBe(
      "Used 2 tools",
    );
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

  it("goes full screen between minimize and close, keeps the conversation, and comes back by its button or Escape", async () => {
    const { view, say } = await mount(
      (l) => {
        l.streams.push([
          { type: "conversation", conversationId },
          { type: "text", text: "Hello there." },
          { type: "end", reason: "stop" },
        ]);
      },
      {},
      DockLayout,
    );
    await view.findByTestId("ai-chat-dock");
    await say("hi");
    await view.findByText("Hello there.");

    const labels = () =>
      [
        ...view.getByTestId("ai-chat").querySelectorAll("button[aria-label]"),
      ].map((button) => button.getAttribute("aria-label"));
    const header = labels();
    const at = header.indexOf("Minimize");
    expect(header.slice(at, at + 3)).toEqual([
      "Minimize",
      "Full screen",
      "Close",
    ]);

    fireEvent.click(view.getByRole("button", { name: "Full screen" }));
    const dialog = await view.findByTestId("ai-chat-fullscreen");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(view.queryByTestId("ai-chat-dock")).toBeNull();
    expect(within(dialog).getByText("Hello there.")).toBeTruthy();
    const back = within(dialog).getByRole("button", {
      name: "Exit full screen",
    });
    expect(back.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(back);
    await view.findByTestId("ai-chat-dock");
    await waitFor(() =>
      expect(view.queryByTestId("ai-chat-fullscreen")).toBeNull(),
    );
    expect(view.getByText("Hello there.")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Full screen" }));
    await view.findByTestId("ai-chat-fullscreen");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await view.findByTestId("ai-chat-dock");
  });

  it("floats over the page's corner without a backdrop, keeps the page usable, minimizes into a pill and restores", async () => {
    const { view } = await mount(
      () => {},
      { title: "Lore", subtitle: "claude-sonnet-5-5" },
      FloatLayout,
    );

    const card = await view.findByTestId("ai-chat-float");
    expect(card.parentElement).toBe(document.body);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-slot='drawer-overlay']")).toBeNull();
    expect(view.getByTestId("ai-chat-subtitle").textContent).toBe(
      "claude-sonnet-5-5",
    );
    // The composer is the card's last part, under the conversation.
    expect(card.querySelector("textarea")).toBeTruthy();

    // The page under it still answers a click, and the card stays.
    fireEvent.click(view.getByRole("button", { name: "Page action" }));
    expect(view.getByTestId("page-clicks").textContent).toBe("1");
    expect(view.getByTestId("ai-chat-float")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Minimize" }));
    expect(view.queryByTestId("ai-chat-float")).toBeNull();
    expect(view.getByTestId("open-state").textContent).toBe("false");
    fireEvent.click(view.getByTestId("ai-chat-launcher"));
    await view.findByTestId("ai-chat-float");

    fireEvent.click(view.getByTestId("ai-chat-maximize"));
    await view.findByTestId("ai-chat-fullscreen");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await view.findByTestId("ai-chat-float");

    fireEvent.click(view.getByRole("button", { name: "Close" }));
    expect(view.queryByTestId("ai-chat-float")).toBeNull();
    expect(view.queryByTestId("ai-chat-launcher")).toBeNull();
  });

  it("shows the app's own mark, empty-state hero and placeholder in place of the defaults (#Q4562)", async () => {
    const { view } = await mount(
      () => {},
      {
        title: "Lore",
        icon: <span data-testid="app-mark" />,
        emptyHero: <span data-testid="app-hero" />,
        placeholder: "Ask Lore",
        suggestions: [{ label: "What is open?" }],
      },
      FloatLayout,
    );

    const header = await view.findByTestId("ai-chat-header");
    expect(within(header).getByTestId("app-mark")).toBeTruthy();
    // The card is named after the title it shows.
    expect(view.getByTestId("ai-chat-float").getAttribute("aria-label")).toBe(
      "Lore",
    );
    expect(header.querySelector(".lucide-sparkles")).toBeNull();
    expect(view.queryByTestId("ai-chat-subtitle")).toBeNull();
    const empty = view.getByTestId("ai-chat-empty");
    expect(within(empty).getByTestId("app-hero")).toBeTruthy();
    expect(empty.textContent).not.toContain("What do you want to do?");
    expect(empty.querySelector(".lucide-sparkles")).toBeNull();
    // The suggestions stay.
    expect(view.getByRole("button", { name: "What is open?" })).toBeTruthy();
    expect(
      (view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .placeholder,
    ).toBe("Ask Lore");

    // The pill wears the same mark.
    fireEvent.click(view.getByRole("button", { name: "Minimize" }));
    const pill = view.getByTestId("ai-chat-launcher");
    expect(within(pill).getByTestId("app-mark")).toBeTruthy();
  });

  it("keeps the generic sparkle, sentences and placeholder for an app that passes none", async () => {
    const { view } = await mount(() => {}, {}, FloatLayout);

    const header = await view.findByTestId("ai-chat-header");
    expect(header.querySelector(".lucide-sparkles")).toBeTruthy();
    const empty = view.getByTestId("ai-chat-empty");
    expect(empty.textContent).toContain("What do you want to do?");
    expect(empty.textContent).toContain("Ask anything about this page.");
    expect(
      (view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .placeholder,
    ).toBe("Ask the assistant");
  });

  it("focuses the composer when it opens and when it comes back from the pill (#Q4562)", async () => {
    const { view } = await mount(() => {}, {}, FloatLayout);

    const box = await view.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(document.activeElement).toBe(box));

    fireEvent.click(view.getByRole("button", { name: "Minimize" }));
    fireEvent.click(view.getByTestId("ai-chat-launcher"));
    const again = await view.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(document.activeElement).toBe(again));
  });

  it("leaves the focus alone when focusOnOpen is off", async () => {
    const { view } = await mount(() => {}, { focusOnOpen: false }, FloatLayout);

    const box = await view.findByRole("textbox", { name: "Message" });
    expect(document.activeElement).not.toBe(box);
  });

  it("drags the floating card by its header, kept on screen, and not by its buttons (#Q4562)", async () => {
    const { view } = await mount(() => {}, {}, FloatLayout);

    const card = await view.findByTestId("ai-chat-float");
    // jsdom lays nothing out: the card's box is given.
    card.getBoundingClientRect = () =>
      ({ left: 500, top: 300, width: 400, height: 400 }) as DOMRect;
    const header = view.getByTestId("ai-chat-header");

    fireEvent.pointerDown(header, { button: 0, clientX: 600, clientY: 320 });
    fireEvent.pointerMove(header, { buttons: 1, clientX: 500, clientY: 270 });
    fireEvent.pointerUp(header, { clientX: 500, clientY: 270 });
    expect(view.getByTestId("ai-chat-float").style.transform).toBe(
      "translate(-100px, -50px)",
    );

    // Pulled far off the top left corner, it stops 8px from the edges.
    card.getBoundingClientRect = () =>
      ({ left: 400, top: 250, width: 400, height: 400 }) as DOMRect;
    fireEvent.pointerDown(header, { button: 0, clientX: 450, clientY: 260 });
    fireEvent.pointerMove(header, {
      buttons: 1,
      clientX: -2000,
      clientY: -2000,
    });
    fireEvent.pointerUp(header);
    expect(view.getByTestId("ai-chat-float").style.transform).toBe(
      "translate(-492px, -292px)",
    );

    // A move with no button down ends a drag whose `pointerup` was lost.
    fireEvent.pointerDown(header, { button: 0, clientX: 450, clientY: 260 });
    fireEvent.pointerMove(header, { buttons: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(header, { buttons: 1, clientX: 300, clientY: 300 });
    expect(view.getByTestId("ai-chat-float").style.transform).toBe(
      "translate(-492px, -292px)",
    );

    // A press on a header button is that button's, not a drag.
    const close = view.getByRole("button", { name: "Minimize" });
    fireEvent.pointerDown(close, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(header, { buttons: 1, clientX: 300, clientY: 300 });
    expect(view.getByTestId("ai-chat-float").style.transform).toBe(
      "translate(-492px, -292px)",
    );

    // Minimized and restored, it is where it was put; a double click on the
    // header brings it back to its corner.
    fireEvent.click(view.getByRole("button", { name: "Minimize" }));
    fireEvent.click(view.getByTestId("ai-chat-launcher"));
    const restored = await view.findByTestId("ai-chat-float");
    expect(restored.style.transform).toBe("translate(-492px, -292px)");
    fireEvent.doubleClick(view.getByTestId("ai-chat-header"));
    expect(view.getByTestId("ai-chat-float").style.transform).toBe("");
  });

  it("does not drag a docked panel", async () => {
    const { view } = await mount(() => {}, {}, DockLayout);

    const header = await view.findByTestId("ai-chat-header");
    expect(header.className).not.toContain("cursor-grab");
  });

  it("keeps a long code line inside its own block: the thread never scrolls sideways, and the float is wider (#Q4546)", async () => {
    const long = `lore host update my-vps --stats-history --stats-interval 60 ${"--flag ".repeat(40)}`;
    const { view, say } = await mount(
      (l) => {
        l.streams.push([
          { type: "conversation", conversationId },
          {
            type: "text",
            text: `Run:\n\n\`\`\`sh\n${long}\n\`\`\`\n\n| flag | value |\n| --- | --- |\n| a | b |\n`,
          },
          { type: "end", reason: "stop" },
        ]);
      },
      {},
      FloatLayout,
    );

    await say(`and ${"https://example.app/a/very/long/path/".repeat(6)}?`);
    const reply = await waitFor(() => {
      const found = view.getByTestId("ai-chat-assistant");
      expect(found.querySelector("pre")?.textContent?.trim()).toBe(long.trim());
      return found;
    });

    const thread = view.getByTestId("ai-chat-thread");
    expect(thread.scrollWidth).toBeLessThanOrEqual(thread.clientWidth);
    // jsdom lays nothing out, so the classes are what hold it: the thread
    // hides what is wider than it, each row is capped at the column (its
    // margin taken off) and may shrink below its content, the code block
    // scrolls on its own, and a long word or URL breaks.
    const classes = (element: Element) => element.className.split(/\s+/);
    expect(classes(thread)).toEqual(
      expect.arrayContaining(["overflow-x-hidden", "overflow-y-auto"]),
    );
    expect(classes(reply)).toEqual(
      expect.arrayContaining([
        "min-w-0",
        "max-w-[calc(100%-1rem)]",
        "break-words",
      ]),
    );
    expect(classes(view.getByTestId("ai-chat-user"))).toEqual(
      expect.arrayContaining([
        "min-w-0",
        "max-w-[calc(100%-2.5rem)]",
        "break-words",
      ]),
    );
    expect(classes(reply.querySelector("pre")!)).toContain("overflow-auto");
    // A wide table scrolls in its own box, since the thread hides overflow.
    expect(classes(reply.querySelector("table")!.parentElement!)).toContain(
      "overflow-x-auto",
    );
    // 30rem on a desktop, and never past the viewport on a phone.
    expect(classes(view.getByTestId("ai-chat-float"))).toContain(
      "w-[min(30rem,calc(100vw-2rem))]",
    );
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
