import { virtualClientFake } from "@lore/core/testing";
import { I18n } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { currentUserAtom } from "alepha/security";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import PromptRunDialog from "./PromptRunDialog.tsx";

const ME = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";

const world = {
  members: [] as { value: string; label: string }[],
  agents: [] as { host: string; agent: string; signedIn?: boolean }[],
};

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      listPromptArgOptions: async () => ({ items: world.members }),
    });
  }
}

/**
 * The Run and Copy dialog (#Q4280): a member arg starts on the signed-in
 * member (#Q4294), which is what the server takes for one left out.
 */
describe("PromptRunDialog", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;
  const submitted: {
    args: Record<string, string>;
    host?: string;
    agent?: string;
    model?: string;
  }[] = [];

  afterEach(async () => {
    submitted.length = 0;
    world.members = [];
    world.agents = [];
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (mode: "copy" | "run", busy = false) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentUserAtom, { id: ME, roles: ["user"] } as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <PromptRunDialog
          open
          onOpenChange={() => {}}
          projectId={1}
          prompt={
            {
              name: "weekly-status",
              title: "Weekly status",
              args: [{ name: "member", type: "member" }],
            } as never
          }
          mode={mode}
          hosts={["desktop"]}
          agents={world.agents}
          busy={busy}
          onSubmit={(body) => submitted.push(body)}
        />
      </AlephaContext.Provider>,
    );
    await screen.findByTestId("prompt-run-dialog");
  };

  const memberTrigger = () =>
    screen
      .getAllByRole("combobox")
      .find((el) => el.tagName === "BUTTON") as HTMLElement;

  for (const mode of ["copy", "run"] as const) {
    it(`starts a member arg on the signed-in member, in ${mode}`, async ({
      expect,
    }) => {
      world.members = [
        { value: OTHER, label: "Grace" },
        { value: ME, label: "Ada" },
      ];
      await show(mode);

      await waitFor(() => expect(memberTrigger().textContent).toContain("Ada"));
      fireEvent.click(screen.getByTestId("prompt-run-submit"));
      await waitFor(() => expect(submitted).toHaveLength(1));
      expect(submitted[0].args).toEqual({ member: ME });
    });
  }

  it("leaves the select empty for someone who is not a member", async ({
    expect,
  }) => {
    world.members = [{ value: OTHER, label: "Grace" }];
    await show("copy");

    // The options are in once the select is no longer disabled.
    await waitFor(() =>
      expect(memberTrigger().hasAttribute("disabled")).toBe(false),
    );
    expect(memberTrigger().textContent).not.toContain("Grace");
    fireEvent.click(screen.getByTestId("prompt-run-submit"));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].args).toEqual({});
  });
  it("offers the models of a signed-in Claude host, and the run carries the one picked (#Q4504)", async ({
    expect,
  }) => {
    world.agents = [{ host: "desktop", agent: "claude", signedIn: true }];
    await show("run");

    const model = await screen.findByRole("combobox", { name: /Model/ });
    fireEvent.click(model);
    for (const family of [
      "claude-haiku",
      "claude-sonnet",
      "claude-opus",
      "claude-fable",
    ]) {
      expect(await screen.findByRole("option", { name: family })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("option", { name: "claude-opus" }));
    fireEvent.click(screen.getByTestId("prompt-run-submit"));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({
      host: "desktop",
      agent: "claude",
      model: "claude-opus-5-5",
    });
  });

  it("offers no model for a signed-out CLI, nor in copy, and a run then keeps the host's default (#Q4504)", async ({
    expect,
  }) => {
    world.agents = [{ host: "desktop", agent: "claude", signedIn: false }];
    await show("run");
    expect(screen.queryByRole("combobox", { name: /Model/ })).toBeNull();
    fireEvent.click(screen.getByTestId("prompt-run-submit"));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].model).toBeUndefined();
    expect(submitted[0].agent).toBeUndefined();
    cleanup();
    await alepha?.stop();

    world.agents = [{ host: "desktop", agent: "claude", signedIn: true }];
    await show("copy");
    expect(screen.queryByRole("combobox", { name: /Model/ })).toBeNull();
  });
  it("spins its submit button while the run is in flight, and only then (#Q4505)", async ({
    expect,
  }) => {
    await show("run");
    const submit = screen.getByTestId("prompt-run-submit");
    expect(submit.getAttribute("aria-busy")).toBeNull();
    cleanup();
    await alepha?.stop();

    await show("run", true);
    const busy = screen.getByTestId("prompt-run-submit");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(true);
  });
});
