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

import type { HostJobResource } from "../../../../../api/schemas/hostJobResourceSchema.ts";
import { projectFixture } from "../../../../../testing/projectFixture.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectJob from "./ProjectJob.tsx";

const RUNNING = "00000000-0000-4000-8000-000000000001";
const DONE = "00000000-0000-4000-8000-000000000002";

const job = (over: Partial<HostJobResource>): HostJobResource =>
  ({
    id: RUNNING,
    projectId: 1,
    hostId: "00000000-0000-4000-8000-0000000000aa",
    hostSlug: "desktop",
    kind: "agent",
    status: "running",
    input: { profile: "read" },
    subjectType: "feedback",
    subjectId: "12",
    queuedAt: "2026-11-23T10:00:00.000Z",
    ...over,
  }) as HostJobResource;

/**
 * What the API answers, set by each case.
 */
const world: {
  jobs: HostJobResource[];
  logs: Record<string, { stdout: string; stderr: string; live: boolean }>;
} = { jobs: [], logs: {} };

class FakeLinks extends LinkProvider {
  override client(): any {
    const answers: Record<string, (input: any) => unknown> = {
      listProjectJobs: () => ({ items: world.jobs }),
      getJob: (input) => world.jobs.find((it) => it.id === input.params.jobId),
      getJobLog: (input) => {
        const log = world.logs[input.params.jobId];
        // The whole log on the first read, nothing past it after.
        const first = (input.query?.stdout ?? 0) === 0;
        return {
          stdout: first ? (log?.stdout ?? "") : "",
          stderr: first ? (log?.stderr ?? "") : "",
          next: { stdout: 1, stderr: 1 },
          live: log?.live ?? false,
        };
      },
    };
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(async (input: unknown) => answers[name]?.(input), {
            can: () => true,
          }),
      },
    );
  }
}

/**
 * The job page (#Q4207): the project's job history on the left, as Chat's
 * rooms, the open job's log in a viewer, and an animation while it runs.
 */
describe("ProjectJob", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (jobId: string) => {
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
        <ProjectJob jobId={jobId} />
      </AlephaContext.Provider>,
    );
    await screen.findByTestId("project-job");
  };

  it("lists the project's jobs in a rail, the open one current", async ({
    expect,
  }) => {
    world.jobs = [
      job({}),
      job({ id: DONE, status: "succeeded", subjectId: "11", exitCode: 0 }),
    ];
    world.logs = {};
    await show(RUNNING);

    const rows = await screen.findAllByTestId("job-history-row");
    expect(rows.map((row) => row.getAttribute("data-job"))).toEqual([
      RUNNING,
      DONE,
    ]);
    expect(rows[0].getAttribute("aria-current")).toBe("page");
    expect(rows[1].getAttribute("aria-current")).toBeNull();
    expect(rows[1].getAttribute("href")).toBe(`/acme/jobs/${DONE}`);
    // Each row's status glyph; the running one spins.
    expect(rows[0].querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin",
    );
  });

  it("animates a running job and follows its log, one numbered line per line with stderr marked", async ({
    expect,
  }) => {
    world.jobs = [job({})];
    world.logs = {
      [RUNNING]: {
        stdout: "cloning\nreading the inbox\n",
        stderr: "warning: slow\n",
        live: true,
      },
    };
    await show(RUNNING);

    const badge = await screen.findByTestId("job-status");
    expect(badge.getAttribute("data-status")).toBe("running");
    expect(badge.querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin",
    );

    const log = screen.getByTestId("job-log");
    await waitFor(() =>
      expect(log.querySelectorAll("li[data-stream]")).toHaveLength(3),
    );
    const lines = [...log.querySelectorAll("li[data-stream]")];
    expect(lines.map((line) => line.textContent)).toEqual([
      "1cloning",
      "2reading the inbox",
      "3warning: slow",
    ]);
    expect(lines[2].getAttribute("data-stream")).toBe("stderr");
    expect(log.getAttribute("data-following")).toBe("true");
    expect(screen.getByTestId("job-log-cursor")).toBeTruthy();
    expect(screen.getByTestId("job-cancel")).toBeTruthy();
  });

  it("waits with a spinner before the first line, and says nothing was printed once ended", async ({
    expect,
  }) => {
    world.jobs = [job({}), job({ id: DONE, status: "succeeded", exitCode: 0 })];
    world.logs = { [RUNNING]: { stdout: "", stderr: "", live: true } };
    await show(RUNNING);
    const waiting = await screen.findByTestId("job-log-empty");
    expect(waiting.textContent).toBe("Waiting for the first line...");
    expect(waiting.querySelector("svg")).not.toBeNull();

    cleanup();
    await alepha?.stop();
    world.logs = { [DONE]: { stdout: "", stderr: "", live: false } };
    await show(DONE);
    await waitFor(() =>
      expect(screen.getByTestId("job-log-empty").textContent).toBe(
        "Nothing was printed.",
      ),
    );
    expect(screen.queryByTestId("job-log-cursor")).toBeNull();
    expect(screen.queryByTestId("job-cancel")).toBeNull();
    expect(
      screen
        .getByTestId("job-status")
        .querySelector("svg")
        ?.getAttribute("class"),
    ).not.toContain("animate-spin");
  });
});
