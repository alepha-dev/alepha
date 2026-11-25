import { DialogProvider } from "@alepha/ui";
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

import type { PromptResource } from "../../../../../api/schemas/promptResourceSchema.ts";
import { projectFixture } from "../../../../../testing/projectFixture.ts";
import { virtualClientFake } from "../../../../../testing/virtualClientFake.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectSettingsPromptsPage from "./ProjectSettingsPromptsPage.tsx";

const prompt = (over: Partial<PromptResource> = {}): PromptResource => ({
  name: "triage",
  builtin: false,
  title: "Triage",
  description: "",
  args: [],
  text: "Triage the inbox",
  source: "none",
  enabled: true,
  permission: "feedback:triage",
  timeoutSeconds: 600,
  on: "manual",
  maxRunsPerHour: 4,
  maxRunsPerDay: 20,
  settleSeconds: 0,
  consecutiveFailures: 0,
  pins: [],
  ...over,
});

/**
 * What the API answers, set by each case, and every write it was sent.
 */
const world = {
  items: [] as PromptResource[],
  pausedAt: undefined as string | undefined,
};

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      listPrompts: async () => ({
        items: world.items,
        pausedAt: world.pausedAt,
        pages: [],
      }),
      listPromptHosts: async () => ({ hosts: [] }),
      listProjectJobs: async () => ({ items: [] }),
    });
  }
}

/**
 * Settings > Prompts, its Prompts tab (#E174).
 */
describe("ProjectSettingsPromptsPage", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    world.items = [];
    world.pausedAt = undefined;
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
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
          <ProjectSettingsPromptsPage />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByText("Triage");
  };

  it("draws Pause left of the primary New prompt, and Resume in the same place once paused (#Q4292)", async ({
    expect,
  }) => {
    world.items = [prompt()];
    await show();

    const labels = () =>
      screen
        .getAllByRole("button")
        .map((it) => it.getAttribute("aria-label"))
        .filter((it) => it === "New prompt" || (it ?? "").endsWith("triggers"));
    expect(labels()).toEqual(["Pause all triggers", "New prompt"]);

    cleanup();
    await alepha?.stop();
    world.pausedAt = "2026-11-25T07:00:00.000Z";
    await show();
    await waitFor(() =>
      expect(labels()).toEqual(["Resume triggers", "New prompt"]),
    );
  });
});
