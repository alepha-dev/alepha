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
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { HostJobResource } from "../../../../../api/schemas/hostJobResourceSchema.ts";
import { projectFixture } from "../../../../../testing/projectFixture.ts";
import { virtualClientFake } from "../../../../../testing/virtualClientFake.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectSettingsPromptJobsPage from "./ProjectSettingsPromptJobsPage.tsx";

const job = (id: number, over: Partial<HostJobResource>): HostJobResource =>
  ({
    id: `00000000-0000-4000-8000-00000000000${id}`,
    projectId: 1,
    hostId: "00000000-0000-4000-8000-0000000000aa",
    hostSlug: "desktop",
    kind: "agent",
    status: "succeeded",
    input: { profile: "read" },
    queuedAt: `2026-11-2${id}T10:00:00.000Z`,
    ...over,
  }) as HostJobResource;

const JOBS = [
  job(1, { prompt: "triage", status: "succeeded" }),
  job(2, { prompt: "triage-errors", status: "failed", hostSlug: "laptop" }),
  job(3, { prompt: "work-quest", status: "succeeded" }),
];

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      listProjectJobs: async () => ({ items: JOBS }),
      listPrompts: async () => ({
        items: [
          { name: "triage", title: "Triage feedback" },
          { name: "triage-errors", title: "Triage errors" },
          { name: "work-quest", title: "Work on quest" },
        ],
        pages: [],
      }),
    });
  }
}

class Routes {
  jobs = $page({
    name: "projectSettingsPromptJobs",
    path: "/:projectSlug/settings/prompts/jobs",
    component: () => null,
  });
}

/**
 * Settings > Prompts > Jobs (#Q4305): Prompt, Status and Host are the
 * table's own filters, on its filter bar, and `?prompt=` opens it narrowed.
 */
describe("ProjectSettingsPromptJobsPage", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    window.history.replaceState({}, "", "/");
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (query: Record<string, string> = {}) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      ...projectFixture(),
      slug: "acme",
    } as never);
    await alepha
      .inject(ReactRouter)
      .push("/acme/settings/prompts/jobs", { query });
    render(
      <AlephaContext.Provider value={alepha}>
        <ProjectSettingsPromptJobsPage />
      </AlephaContext.Provider>,
    );
  };

  const prompts = () =>
    screen.queryAllByTestId("job-prompt").map((it) => it.textContent);

  it("draws no form of its own above the table, and lists every job", async ({
    expect,
  }) => {
    await show();
    await waitFor(() => expect(prompts()).toHaveLength(3));
    expect(document.querySelector("form.chrome")).toBeNull();
  });

  it("opens on ?prompt= narrowed to that prompt exactly, its title on the filter", async ({
    expect,
  }) => {
    await show({ prompt: "triage" });
    await waitFor(() => expect(prompts()).toEqual(["Triage feedback"]));
    // Not `triage-errors`, which a substring match would keep.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("combobox")
          .some((el) => el.textContent?.includes("Triage feedback")),
      ).toBe(true),
    );
  });

  it("narrows to a status picked on the bar", async ({ expect }) => {
    await show();
    await waitFor(() => expect(prompts()).toHaveLength(3));

    const status = screen
      .getAllByRole("combobox")
      .find(
        (el) =>
          el.tagName === "BUTTON" && el.getAttribute("aria-label") === "Status",
      ) as HTMLElement;
    fireEvent.keyDown(status, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "failed" }));

    await waitFor(() => expect(prompts()).toEqual(["Triage errors"]));
  });
});
