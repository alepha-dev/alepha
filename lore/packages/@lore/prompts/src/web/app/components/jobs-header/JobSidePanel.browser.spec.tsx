import { DialogProvider } from "@alepha/ui";
import type { HostJobResource } from "@lore/core/schemas";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { I18n, currentProjectAtom, sidePanelAtom } from "@lore/core/web";
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
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { act } from "react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { jobPanelAtom } from "../../atoms/jobPanelAtom.ts";
import JobSidePanel from "./JobSidePanel.tsx";

const ID = "00000000-0000-4000-8000-000000000001";

const STEPS: NonNullable<HostJobResource["steps"]> = {
  unit: "quest",
  total: 3,
  done: 1,
  quests: [
    {
      shortId: 11,
      title: "First",
      acceptedAt: "2026-11-26T10:00:10.000Z",
      completedAt: "2026-11-26T10:20:00.000Z",
      objectives: { total: 2, done: 2, waived: 0 },
    },
    {
      shortId: 12,
      title: "Second",
      acceptedAt: "2026-11-26T10:00:10.000Z",
      objectives: { total: 4, done: 1, waived: 0 },
    },
    {
      shortId: 13,
      title: "Third",
      acceptedAt: "2026-11-26T10:00:10.000Z",
      objectives: { total: 1, done: 0, waived: 0 },
    },
  ],
  pending: [],
  current: 12,
  stepTimes: ["2026-11-26T10:20:00.000Z"],
};

const world = {
  job: undefined as HostJobResource | undefined,
  stdout: "",
  reads: 0,
};

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      getJob: async () => world.job,
      getJobLog: async () => {
        world.reads++;
        return {
          stdout: world.stdout,
          stderr: "",
          next: { stdout: world.stdout.length, stderr: 0 },
          live: world.job?.status === "running",
        };
      },
      listPrompts: async () => ({
        items: [{ name: "work-quest", title: "Work on quest" }],
        pages: [],
      }),
    });
  }
}

class Routes {
  job = $page({
    name: "projectJob",
    path: "/:projectSlug/jobs/:jobId",
    component: () => null,
  });
}

const job = (over: Partial<HostJobResource>): HostJobResource =>
  ({
    id: ID,
    projectId: 1,
    hostId: "00000000-0000-4000-8000-0000000000aa",
    hostSlug: "desktop",
    kind: "agent",
    status: "running",
    input: { agent: "claude" },
    prompt: "work-quest",
    args: [
      {
        name: "quest",
        type: "quest",
        value: "12",
        reference: "#Q12",
        title: "Fix the cart",
      },
    ],
    queuedAt: "2026-11-26T10:00:00.000Z",
    startedAt: "2026-11-26T10:00:05.000Z",
    ...over,
  }) as HostJobResource;

/**
 * The job side panel (#Q4515): a job watched from any page, opened from
 * the header's jobs list, read through the job page's own reader.
 */
describe("JobSidePanel", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    world.job = undefined;
    world.stdout = "";
    world.reads = 0;
  });

  const show = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(Routes);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      ...projectFixture(),
      slug: "acme",
    } as never);
    alepha.store.set(sidePanelAtom, { panel: "job" });
    alepha.store.set(jobPanelAtom, { jobId: ID });
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <JobSidePanel />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return alepha;
  };

  it("shows a running job, its transcript live, Open job and Cancel", async ({
    expect,
  }) => {
    world.job = job({});
    world.stdout = `${JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Reading the cart total." }] },
    })}\n`;
    await show();

    expect(
      (await screen.findByTestId("job-panel-title")).textContent,
    ).toContain("Work on quest #Q12 Fix the cart");
    expect(await screen.findByText("Reading the cart total.")).toBeTruthy();
    expect(screen.getByTestId("job-panel-open")).toBeTruthy();
    expect(screen.getByTestId("job-panel-cancel")).toBeTruthy();
    // No steps, no usual time: no bar.
    expect(screen.queryByTestId("job-steps")).toBeNull();
    expect(screen.queryByTestId("job-usual")).toBeNull();
  });

  it("shows a running job's steps in its header, and its usual time when it has no steps (#Q4545)", async ({
    expect,
  }) => {
    world.job = job({ steps: STEPS });
    await show();

    expect((await screen.findByTestId("job-steps-text")).textContent).toBe(
      "Quest 2 of 3",
    );
    expect(screen.getAllByTestId("job-steps-segment")).toHaveLength(3);
    expect(screen.getByTestId("job-steps-current").textContent).toContain(
      "#12 Second",
    );
    cleanup();
    await alepha?.stop();

    world.job = job({ usual: { runs: 6, low: 60, high: 120, p90: 180 } });
    await show();
    expect((await screen.findByTestId("job-usual")).textContent).toContain(
      "1 min",
    );
    expect(screen.queryByTestId("job-steps")).toBeNull();
  });

  it("shows an ended job's final reply first, and no Cancel", async ({
    expect,
  }) => {
    world.job = job({
      status: "succeeded",
      endedAt: "2026-11-26T10:04:05.000Z",
      result: "Fixed the cart total, PR opened.",
    });
    await show();

    expect(
      await screen.findByText("Fixed the cart total, PR opened."),
    ).toBeTruthy();
    expect(
      screen.getByTestId("job-panel-title").parentElement?.textContent,
    ).toContain("04:00");
    expect(screen.queryByTestId("job-panel-cancel")).toBeNull();
  });

  it("closes with its button, with Escape, and when the assistant takes the right of the page", async ({
    expect,
  }) => {
    world.job = job({});
    const app = await show();
    await screen.findByTestId("job-panel");

    fireEvent.keyDown(globalThis.window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("job-panel")).toBeNull());

    await act(async () => {
      app.store.set(jobPanelAtom, { jobId: ID });
    });
    await screen.findByTestId("job-panel");
    fireEvent.click(screen.getByTestId("job-panel-close"));
    await waitFor(() => expect(screen.queryByTestId("job-panel")).toBeNull());

    await act(async () => {
      app.store.set(jobPanelAtom, { jobId: ID });
    });
    await screen.findByTestId("job-panel");
    await act(async () => {
      app.store.set(sidePanelAtom, { panel: "assistant" });
    });
    await waitFor(() => expect(screen.queryByTestId("job-panel")).toBeNull());
  });

  it("leaves Escape to the Cancel confirm while it is open", async ({
    expect,
  }) => {
    world.job = job({});
    await show();
    fireEvent.click(await screen.findByTestId("job-panel-cancel"));
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(globalThis.window, { key: "Escape" });
    expect(screen.getByTestId("job-panel")).toBeTruthy();
  });

  it("reads nothing while closed", async ({ expect }) => {
    world.job = job({ status: "succeeded" });
    const app = await show();
    await screen.findByTestId("job-panel");
    fireEvent.click(screen.getByTestId("job-panel-close"));
    await waitFor(() => expect(screen.queryByTestId("job-panel")).toBeNull());
    const reads = world.reads;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    expect(world.reads).toBe(reads);
    expect(app.store.get(jobPanelAtom)).toEqual({});
  });
});
