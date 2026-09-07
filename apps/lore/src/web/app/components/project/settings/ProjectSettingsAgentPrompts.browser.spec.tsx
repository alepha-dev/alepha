import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { projectFixture } from "@/testing/projectFixture.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { projectPromptsAtom } from "@/web/app/atoms/projectPromptsAtom.ts";
import { AGENT_PROMPT_DEFAULTS } from "@/web/app/prompts/agentPromptDefaults.ts";
import { I18n } from "@/web/app/services/I18n.ts";

import ProjectSettingsAgentPrompts from "./ProjectSettingsAgentPrompts.tsx";

interface Call {
  action: string;
  input: unknown;
}

/**
 * A `LinkProvider` that records what the section asked for and answers with
 * the rows the case wants, so the read-write cycle is exercised without a
 * server. Service substitution, per the repo's rule against `vi.mock`.
 */
class FakeLinkProvider extends LinkProvider {
  calls: Call[] = [];
  rows: Array<{ kind: string; template: string }> = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const action = <T extends (...args: any[]) => Promise<unknown>>(fn: T) =>
      Object.assign(fn, { can: () => true });
    const record = (name: string, fn: (input: any) => unknown) =>
      action(async (input: any) => {
        this.calls.push({ action: name, input });
        return fn(input);
      });
    return new Proxy(
      {
        getProjectPrompts: record("getProjectPrompts", () => [...this.rows]),
        setProjectPrompt: record("setProjectPrompt", (input) => ({
          kind: input.params.kind,
          template: input.body.template,
        })),
        resetProjectPrompt: record("resetProjectPrompt", (input) => ({
          kind: input.params.kind,
        })),
      } as Record<string, unknown>,
      {
        get: (target, prop: string) =>
          target[prop] ?? action(async () => undefined),
      },
    );
  }
}

describe("ProjectSettingsAgentPrompts", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (options?: {
    project?: unknown;
    rows?: Array<{ kind: string; template: string }>;
  }) => {
    alepha = Alepha.create()
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    const links = alepha.inject(FakeLinkProvider);
    links.rows = options?.rows ?? [];

    alepha.store.set(
      currentProjectAtom,
      (options?.project ?? projectFixture()) as never,
    );
    // What the route loader leaves behind: indistinguishable from "the
    // option was off", which is why the section refetches.
    alepha.store.set(projectPromptsAtom, {} as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectSettingsAgentPrompts />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return { view, links };
  };

  const editor = (kind: string) =>
    screen.queryByTestId(`prompt-input-${kind}`) as HTMLTextAreaElement | null;

  /**
   * ⚠️ `projectFixture()` turns every declared option ON, so every presence
   * case gets `agentPrompts` for free and this is the only case that has to
   * pass a fixture argument.
   */
  it("renders nothing when the project has agent prompts off", async () => {
    const { links } = await mount({
      project: projectFixture({ options: { work: { agentPrompts: false } } }),
    });

    expect(screen.queryByText("Agent prompts")).toBe(null);
    // And it does not pay for a read it will not show.
    expect(links.calls).toEqual([]);
  });

  it("seeds each editor with the built-in default when nothing is stored", async () => {
    await mount();

    await waitFor(() => expect(editor("epicReview")).not.toBeNull());
    expect(editor("epicReview")!.value).toBe(AGENT_PROMPT_DEFAULTS.epicReview);
    expect(editor("feedbackWork")!.value).toBe(
      AGENT_PROMPT_DEFAULTS.feedbackWork,
    );
  });

  /**
   * ⚠️ The hole this section exists to close. The loader writes `{}` both
   * when the option is off and when nothing is customised, and flipping the
   * switch does not re-run it. Without this fetch, an owner who turns the
   * option on and copies a prompt gets the built-in defaults over their own
   * stored templates.
   */
  it("refetches the stored rows and writes them back to the atom", async () => {
    const { links } = await mount({
      rows: [{ kind: "questWork", template: "my own quest prompt" }],
    });

    await waitFor(() =>
      expect(editor("questWork")?.value).toBe("my own quest prompt"),
    );
    expect(links.calls.map((it) => it.action)).toContain("getProjectPrompts");
    // The atom, not just the editor: it is what the Epics menu copies from.
    expect(alepha!.store.get(projectPromptsAtom)).toEqual({
      questWork: "my own quest prompt",
    });
  });

  it("keeps Save disabled until the text changes", async () => {
    await mount();
    await waitFor(() => expect(editor("epicReview")).not.toBeNull());

    const saves = screen.getAllByRole("button", { name: "Save" });
    expect(saves[0].hasAttribute("disabled")).toBe(true);

    fireEvent.change(editor("epicReview")!, {
      target: { value: "something else" },
    });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: "Save" })[0]
          .hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  /**
   * The column is `.min(1)`, so an empty template is refused server-side. A
   * Save button that always 400s is a button that lies about what it does.
   */
  it("keeps Save disabled on an empty template", async () => {
    await mount();
    await waitFor(() => expect(editor("epicReview")).not.toBeNull());

    fireEvent.change(editor("epicReview")!, { target: { value: "   " } });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: "Save" })[0]
          .hasAttribute("disabled"),
      ).toBe(true),
    );
  });

  it("saves the edited template and writes it to the atom", async () => {
    const { links } = await mount();
    await waitFor(() => expect(editor("epicReview")).not.toBeNull());

    fireEvent.change(editor("epicReview")!, { target: { value: "mine" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() =>
      expect(links.calls.some((it) => it.action === "setProjectPrompt")).toBe(
        true,
      ),
    );
    await waitFor(() =>
      expect(alepha!.store.get(projectPromptsAtom)).toEqual({
        epicReview: "mine",
      }),
    );
  });

  /**
   * Reset is offered only while a row exists: on a kind that already follows
   * the default there is nothing to reset.
   */
  it("offers Reset only for a kind that has a stored row", async () => {
    await mount({ rows: [{ kind: "questWork", template: "mine" }] });

    await waitFor(() =>
      expect(screen.queryByTestId("prompt-reset-questWork")).not.toBeNull(),
    );
    expect(screen.queryByTestId("prompt-reset-epicReview")).toBe(null);
  });

  it("names all seven placeholders, the title and the slug apart", async () => {
    await mount();
    await waitFor(() => expect(editor("epicReview")).not.toBeNull());

    for (const name of [
      "project",
      "slug",
      "number",
      "id",
      "reference",
      "title",
      "url",
    ]) {
      expect(screen.queryByText(`{{${name}}}`)).not.toBeNull();
    }
    // ⚠️ The legend has to say which is which, because passing the slug
    // where the title belongs resolves nothing over MCP.
    expect(
      screen.getByText(/The project's title, which is what an MCP call/),
    ).toBeTruthy();
  });
});
