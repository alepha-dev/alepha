import type { HostJobResource } from "@lore/core/schemas";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import { I18n, currentProjectAtom } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import {
  jobsAnnouncementAtom,
  jobsStartedHereAtom,
} from "./jobsHeaderAtoms.ts";
import PromptJobsButton from "./PromptJobsButton.tsx";

/**
 * The paused clock of the running spec: a job's times are read against it.
 */
const clock = { now: 0 };
const ago = (seconds: number) =>
  new Date(clock.now - seconds * 1000).toISOString();

const job = (id: number, over: Partial<HostJobResource>): HostJobResource =>
  ({
    id: `00000000-0000-4000-8000-00000000000${id}`,
    projectId: 1,
    hostId: "00000000-0000-4000-8000-0000000000aa",
    hostSlug: "desktop",
    kind: "agent",
    status: "queued",
    input: { agent: "claude" },
    queuedAt: ago(60),
    ...over,
  }) as HostJobResource;

const world = {
  jobs: (): HostJobResource[] => [],
  tail: "",
};

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      listProjectJobs: async () => ({ items: world.jobs() }),
      listPrompts: async () => ({
        items: [
          { name: "triage", title: "Triage feedback" },
          { name: "work-quest", title: "Work on quest" },
        ],
        pages: [],
      }),
      getJobLog: async () => ({
        stdout: world.tail,
        stderr: "",
        next: { stdout: world.tail.length, stderr: 0 },
        start: 0,
        live: true,
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

/**
 * The header's jobs button (#Q4514): the project's agent jobs in flight, a
 * ring while one runs, their count, its list, and what it says when a job
 * this tab started is queued or ends.
 */
describe("PromptJobsButton", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    world.jobs = () => [];
    world.tail = "";
  });

  const show = async (
    capabilities: unknown[] = [
      { key: "prompts", options: {}, enabledAt: "2026-11-01T00:00:00.000Z" },
    ],
    startedHere: string[] = [],
  ) => {
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
    clock.now = alepha.inject(DateTimeProvider).pause().valueOf();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(jobsStartedHereAtom, startedHere);
    alepha.store.set(currentProjectAtom, {
      ...projectFixture(),
      slug: "acme",
      capabilities,
      permissions: ["host:read"],
    } as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <PromptJobsButton />
      </AlephaContext.Provider>,
    );
  };

  it("is the icon alone with no job in flight, and lists nothing", async ({
    expect,
  }) => {
    world.jobs = () => [
      job(1, {
        status: "succeeded",
        queuedAt: ago(7200),
        endedAt: ago(7000),
        prompt: "triage",
      }),
    ];
    await show();
    const button = await screen.findByTestId("jobs-header-button");
    await waitFor(() =>
      expect(button.getAttribute("data-in-flight")).toBe("0"),
    );
    expect(screen.queryByTestId("jobs-header-count")).toBeNull();
    expect(screen.queryByTestId("jobs-header-ring")).toBeNull();
    fireEvent.click(button);
    const popover = await screen.findByTestId("jobs-header-popover");
    expect(popover.textContent).toContain("None in flight");
    expect(within(popover).queryAllByTestId("jobs-header-row")).toHaveLength(0);
  });

  it("counts a queued and a running job, rings while one runs, and lists them with the one that just ended", async ({
    expect,
  }) => {
    world.jobs = () => [
      job(1, { status: "queued", prompt: "triage", queuedAt: ago(10) }),
      job(2, {
        status: "running",
        prompt: "work-quest",
        queuedAt: ago(300),
        startedAt: ago(252),
        args: [
          {
            name: "quest",
            type: "quest",
            value: "12",
            reference: "#Q12",
            title: "Fix the cart",
          },
        ],
      }),
      job(3, {
        status: "failed",
        prompt: "triage",
        queuedAt: ago(900),
        endedAt: ago(600),
      }),
    ];
    world.tail = `${JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Switching to the order total." }],
      },
    })}\n`;
    await show();

    expect((await screen.findByTestId("jobs-header-count")).textContent).toBe(
      "2",
    );
    expect(screen.getByTestId("jobs-header-ring")).toBeTruthy();

    fireEvent.click(screen.getByTestId("jobs-header-button"));
    const popover = await screen.findByTestId("jobs-header-popover");
    expect(popover.textContent).toContain("1 running · 1 queued");
    const rows = await within(popover).findAllByTestId("jobs-header-row");
    expect(rows.map((it) => it.getAttribute("data-status"))).toEqual([
      "queued",
      "running",
      "failed",
    ]);
    expect(rows[1]!.textContent).toContain("Work on quest #Q12 Fix the cart");
    expect(rows[1]!.textContent).toContain("04:12");
    expect(rows[2]!.textContent).toContain("failed");
    await waitFor(() =>
      expect(
        within(rows[1]!).getByTestId("jobs-header-last-line").textContent,
      ).toBe("Switching to the order total."),
    );
  });

  it("says the job this tab queued", async ({ expect }) => {
    const id = "00000000-0000-4000-8000-000000000001";
    world.jobs = () => [job(1, { status: "queued", prompt: "triage" })];
    await show();
    alepha!.store.set(jobsStartedHereAtom, [id]);
    alepha!.store.set(jobsAnnouncementAtom, {
      jobId: id,
      prompt: "triage",
      word: "queued",
      at: 1,
    });
    expect(
      (await screen.findByTestId("jobs-header-announcement")).textContent,
    ).toBe("Triage feedback · queued");
  });

  it("names a job this tab started once it has ended, and forgets it", async ({
    expect,
  }) => {
    const id = "00000000-0000-4000-8000-000000000001";
    world.jobs = () => [
      job(1, {
        status: "succeeded",
        prompt: "triage",
        queuedAt: ago(120),
        endedAt: ago(5),
      }),
    ];
    await show(undefined, [id]);
    expect(
      (await screen.findByTestId("jobs-header-announcement")).textContent,
    ).toBe("Triage feedback · done");
    expect(alepha!.store.get(jobsStartedHereAtom)).toEqual([]);
  });

  it("is absent with Prompts off", async ({ expect }) => {
    await show([]);
    expect(screen.queryByTestId("jobs-header-button")).toBeNull();
  });
});
