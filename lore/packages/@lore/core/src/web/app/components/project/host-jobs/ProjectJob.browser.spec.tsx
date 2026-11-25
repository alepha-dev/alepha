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
 * The job page (#Q4286): the job titled by its prompt in the aside, its
 * transcript with the reply first, the raw log one tab away with an
 * animation while it runs, and no rail of other jobs.
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

  it("reads a finished run as a transcript: the reply first, then what the agent said and did, and no rail", async ({
    expect,
  }) => {
    world.jobs = [
      job({
        id: DONE,
        status: "succeeded",
        exitCode: 0,
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
        cause: { kind: "hand" },
        result: "Shipped **the fix**.",
        input: { agent: "claude", prompt: "Work on quest #Q12" } as never,
      }),
    ];
    world.logs = {
      [DONE]: {
        stdout: [
          JSON.stringify({ type: "system", subtype: "init", model: "m-1" }),
          JSON.stringify({
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "t1",
                  name: "Bash",
                  input: { command: "yarn test" },
                },
              ],
            },
          }),
          JSON.stringify({
            type: "user",
            message: {
              content: [
                { type: "tool_result", tool_use_id: "t1", content: "ok" },
              ],
            },
          }),
          JSON.stringify({ type: "rate_limit_event", rate_limit_info: {} }),
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "All green." }] },
          }),
        ].join("\n"),
        stderr: "",
        live: false,
      },
    };
    await show(DONE);

    const title = await screen.findByTestId("job-title");
    expect(title.textContent).toContain("work-quest");
    expect(title.querySelector("a")?.getAttribute("href")).toBe(
      "/acme/quests/12",
    );
    await waitFor(() =>
      expect(screen.getByTestId("job-reply").textContent).toContain("Shipped"),
    );
    expect(screen.getByTestId("job-reply").querySelector("strong")).not.toBe(
      null,
    );
    const events = screen.getByTestId("job-events");
    await waitFor(() => expect(events.textContent).toContain("All green."));
    // The tool group starts folded (#Q4308), and opens on its line.
    const trace = screen.getByTestId("ai-chat-tool-trace");
    const line = trace.querySelector("button[aria-expanded]") as HTMLElement;
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("ai-chat-tool-trace-steps")).toBeNull();
    expect(events.textContent).not.toContain("yarn test");
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByTestId("ai-chat-tool-trace-steps").textContent,
    ).toContain("yarn test");
    expect(events.textContent).toContain("1 bookkeeping events hidden");
    expect(screen.queryAllByTestId("job-history-row")).toHaveLength(0);
  });

  it("scrolls each tab inside its own pane, under an aside and a tab strip that stay put (#Q4295)", async ({
    expect,
  }) => {
    world.jobs = [
      job({
        id: DONE,
        status: "succeeded",
        exitCode: 0,
        input: { agent: "claude", prompt: "Work on quest #Q12" } as never,
      }),
    ];
    world.logs = { [DONE]: { stdout: "one\ntwo\n", stderr: "", live: false } };
    await show(DONE);

    // jsdom lays nothing out, so the spec checks what makes the pane, and
    // never the page, the element that scrolls: a bounded column all the way
    // down, and the overflow on the pane itself.
    const page = screen.getByTestId("project-job");
    expect(page.className).toContain("h-full");
    expect(page.className).toContain("min-h-0");
    const pane = await screen.findByTestId("job-transcript");
    expect(pane.className).toContain("min-h-0");
    expect(pane.className).toContain("overflow-y-auto");

    fireEvent.click(screen.getByText("Raw log"));
    const log = await screen.findByTestId("job-log");
    expect(log.className).toContain("min-h-0");
    expect(log.className).toContain("overflow-auto");

    fireEvent.click(screen.getByText("Prompt"));
    const prompt = await screen.findByTestId("job-prompt-text");
    expect(prompt.className).toContain("min-h-0");
    expect(prompt.className).toContain("overflow-auto");

    // The tab is kept in the address, which outlives this case under jsdom.
    fireEvent.click(screen.getByText("Transcript"));
    await screen.findByTestId("job-transcript");
  });

  it("puts a failed job's reason first", async ({ expect }) => {
    world.jobs = [
      job({ status: "failed", reason: "The agent exited with status 1" }),
    ];
    world.logs = { [RUNNING]: { stdout: "", stderr: "", live: false } };
    await show(RUNNING);
    const failure = await screen.findByTestId("job-failure");
    expect(failure.textContent).toContain("The agent exited with status 1");
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
    fireEvent.click(await screen.findByText("Raw log"));

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
    fireEvent.click(await screen.findByText("Raw log"));
    const waiting = await screen.findByTestId("job-log-empty");
    expect(waiting.textContent).toBe("Waiting for the first line...");
    expect(waiting.querySelector("svg")).not.toBeNull();

    cleanup();
    await alepha?.stop();
    world.logs = { [DONE]: { stdout: "", stderr: "", live: false } };
    await show(DONE);
    fireEvent.click(await screen.findByText("Raw log"));
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
