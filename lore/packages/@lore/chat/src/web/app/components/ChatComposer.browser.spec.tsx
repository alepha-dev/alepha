import { I18n } from "@lore/core/web";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, it } from "vitest";

import type { ChatRoomResource } from "../../../schemas/index.ts";
import ChatComposer, { type ChatMentionCandidate } from "./ChatComposer.tsx";

const ROOM: ChatRoomResource = {
  id: crypto.randomUUID(),
  projectId: 1,
  name: "general",
  private: false,
  createdAt: "2026-11-19T12:00:00.000Z",
  memberCount: 3,
  joined: true,
};

const CANDIDATES: ChatMentionCandidate[] = [
  { handle: "ada", label: "Ada Lovelace" },
  { handle: "alan", label: "Alan Turing" },
  { handle: "grace", label: "Grace Hopper" },
  { handle: "lore", label: "Lore", agent: true, builtin: true },
  { handle: "jarvis", label: "Jarvis", agent: true },
];

/**
 * The composer's `@` popup (#E161, #Q3937), driven by keyboard only: what a
 * member typing a message does, and what a screen reader follows.
 */
describe("ChatComposer", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    sent: string[] = [],
    answer: () => Promise<boolean> = async () => true,
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <ChatComposer
          room={ROOM}
          candidates={CANDIDATES}
          onUpload={async () => undefined}
          onSend={async (body) => {
            sent.push(body);
            return answer();
          }}
        />
      </AlephaContext.Provider>,
    );
    return screen.getByRole("combobox") as HTMLTextAreaElement;
  };

  const type = (input: HTMLTextAreaElement, text: string) => {
    fireEvent.change(input, {
      target: { value: text, selectionStart: text.length },
    });
    input.setSelectionRange(text.length, text.length);
    fireEvent.select(input);
  };

  const options = () =>
    screen
      .queryAllByRole("option")
      .map((option) => option.getAttribute("data-handle"));

  it("opens on @ with the agent first, and narrows as you type", async ({
    expect,
  }) => {
    const input = await mount();

    type(input, "hi @");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(options()[0]).toBe("lore");
    expect(options()).toHaveLength(5);

    type(input, "hi @a");
    expect(options()).toEqual(["ada", "alan"]);

    // A word of the name counts too.
    type(input, "hi @hop");
    expect(options()).toEqual(["grace"]);
  });

  it("lists a project's agent with its initials and its name, and inserts its handle", async ({
    expect,
  }) => {
    const input = await mount();

    type(input, "@ja");
    expect(options()).toEqual(["jarvis"]);
    const option = screen.getByRole("option");
    expect(option.textContent).toContain("Jarvis");
    expect(
      option.querySelector("[data-testid='chat-agent-initials']")?.textContent,
    ).toBe("JA");
    // The built-in keeps its bot and its hint.
    type(input, "@lor");
    expect(screen.getByRole("option").textContent).toContain(
      "Prompt the agent",
    );

    type(input, "@ja");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("@jarvis ");
  });

  it("moves with the arrows, inserts with Enter, and sends nothing while choosing", async ({
    expect,
  }) => {
    const sent: string[] = [];
    const input = await mount(sent);

    type(input, "ping @a");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[0]!.id,
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      screen.getAllByRole("option")[1]!.getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input.value).toBe("ping @alan ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("inserts with Tab and closes on Escape", async ({ expect }) => {
    const input = await mount();

    type(input, "@gr");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("@grace ");

    type(input, "@grace and @");
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.value).toBe("@grace and @");
  });

  it("does not open inside a word, as in an email address", async ({
    expect,
  }) => {
    const input = await mount();

    type(input, "mail ada@ex");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("empties on Enter before the send answers, and gets the text back when it fails", async ({
    expect,
  }) => {
    let answer!: (ok: boolean) => void;
    const sent: string[] = [];
    const input = await mount(
      sent,
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );

    type(input, "hello there");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sent).toEqual(["hello there"]);
    expect(input.value).toBe("");

    await act(async () => answer(false));
    expect(input.value).toBe("hello there");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("");
    await act(async () => answer(true));
    expect(input.value).toBe("");
  });
});
