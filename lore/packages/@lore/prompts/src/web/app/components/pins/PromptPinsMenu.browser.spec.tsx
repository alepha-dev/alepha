import { DialogProvider } from "@alepha/ui";
import type { PromptResource } from "@lore/core/schemas";
import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import PromptPinsMenu from "./PromptPinsMenu.tsx";

const INVESTIGATE = {
  name: "investigate-error",
  builtin: true,
  title: "Investigate error",
  description: "",
  args: [{ name: "error", type: "error" }],
  text: "Investigate {{error.reference}}",
  source: "read",
  enabled: true,
  permission: "error:read",
  timeoutSeconds: 600,
  on: "manual",
  maxRunsPerHour: 6,
  maxRunsPerDay: 48,
  concurrency: "unique",
  pins: ["error"],
} as unknown as PromptResource;

class FakeLinks extends LinkProvider {
  /**
   * The project's prompts, set per test.
   */
  public static prompts: PromptResource[] = [INVESTIGATE];
  public static asked: string[] = [];

  override client(): any {
    const answers: Record<string, () => unknown> = {
      listPrompts: () => ({ items: FakeLinks.prompts, pages: [] }),
      listPromptHosts: () => ({ hosts: ["desktop"] }),
    };
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(
            async () => {
              FakeLinks.asked.push(name);
              return answers[name]?.() ?? { items: [] };
            },
            { can: () => true },
          ),
      },
    );
  }
}

const REASON = "No agent reads this error until a member trusts it";

/**
 * The robot button on an item no prompt may run on (#Q4471): an error no
 * member trusted. It stays, disabled, with the reason: absent, it would
 * read as a page with no prompt.
 */
describe("PromptPinsMenu on a blocked item", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    FakeLinks.prompts = [INVESTIGATE];
    FakeLinks.asked = [];
  });

  const mount = async (blocked?: string) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      ...projectFixture(),
      slug: "acme",
    } as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <PromptPinsMenu
            page="error"
            item={{ type: "error", value: "42", status: "open" }}
            blocked={blocked}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await waitFor(() => {
      if (!FakeLinks.asked.includes("listPrompts")) {
        throw new Error("the prompts are not read yet");
      }
    });
  };

  it("draws the button enabled on an item a prompt may run on", async ({
    expect,
  }) => {
    await mount();
    const button = await screen.findByTestId("pinned-prompts");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByTestId("pinned-prompts-blocked")).toBeNull();
  });

  it("draws it disabled, named by its reason, on a blocked item", async ({
    expect,
  }) => {
    await mount(REASON);
    const button = await screen.findByTestId("pinned-prompts");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-label")).toBe(REASON);
    expect(screen.getByTestId("pinned-prompts-blocked")).toBeTruthy();
  });

  it("draws nothing on a page no prompt is pinned to, blocked or not", async ({
    expect,
  }) => {
    FakeLinks.prompts = [];
    await mount(REASON);
    expect(screen.queryByTestId("pinned-prompts")).toBeNull();
  });
});
