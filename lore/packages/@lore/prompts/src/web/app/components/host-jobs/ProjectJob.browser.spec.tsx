import { DialogProvider } from "@alepha/ui";
import type { HostJobResource } from "@lore/core/schemas";
import { projectFixture } from "@lore/core/testing";
import { I18n, currentProjectAtom } from "@lore/core/web";
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
  /** Every action the page called, by name. */
  calls: string[];
  /** What each pokeJob call sent. */
  pokes: Array<string | undefined>;
} = { jobs: [], logs: {}, calls: [], pokes: [] };

class FakeLinks extends LinkProvider {
  override client(): any {
    const answers: Record<string, (input: any) => unknown> = {
      listProjectJobs: () => ({ items: world.jobs }),
      getJob: (input) => world.jobs.find((it) => it.id === input.params.jobId),
      pokeJob: (input) => {
        world.pokes.push(input.body.message);
        return world.jobs[0];
      },
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
          Object.assign(
            async (input: unknown) => {
              world.calls.push(name);
              return answers[name]?.(input);
            },
            {
              can: () => true,
            },
          ),
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
        <DialogProvider>
          <ProjectJob jobId={jobId} />
        </DialogProvider>
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
    // Bookkeeping events stay out, with no toggle to show them (#Q4529).
    expect(events.textContent).not.toContain("bookkeeping");
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
    // The conversation sits in a centred reading column inside the
    // full-width pane (#Q4416).
    const column = screen.getByTestId("job-transcript-column");
    expect(column.className).toContain("mx-auto");
    expect(column.className).toContain("max-w-3xl");
    expect(column.contains(screen.getByTestId("job-events"))).toBe(true);

    // Two tabs since #Q4403: the raw log is the toolbar's download.
    expect(screen.queryByText("Raw log")).toBeNull();

    fireEvent.click(screen.getByText("Prompt"));
    const prompt = await screen.findByTestId("job-prompt-text");
    expect(prompt.className).toContain("min-h-0");
    expect(prompt.className).toContain("overflow-auto");

    // The tab is kept in the address, which outlives this case under jsdom.
    fireEvent.click(screen.getByText("Transcript"));
    await screen.findByTestId("job-transcript");
  });

  it("names the model that ran when the run named none: the server's, else the transcript's (#Q4304)", async ({
    expect,
  }) => {
    world.jobs = [
      job({
        id: DONE,
        status: "succeeded",
        exitCode: 0,
        input: { agent: "claude", prompt: "Triage" } as never,
      }),
    ];
    world.logs = {
      [DONE]: {
        stdout: JSON.stringify({
          type: "system",
          subtype: "init",
          model: "m-from-the-log",
        }),
        stderr: "",
        live: false,
      },
    };
    await show(DONE);
    await waitFor(() =>
      expect(screen.getByTestId("project-job").textContent).toContain(
        "m-from-the-log",
      ),
    );

    cleanup();
    await alepha?.stop();
    world.jobs = [
      job({
        id: DONE,
        status: "succeeded",
        exitCode: 0,
        input: { agent: "claude", prompt: "Triage" } as never,
        model: "m-from-the-server",
      }),
    ];
    await show(DONE);
    await waitFor(() =>
      expect(screen.getByTestId("project-job").textContent).toContain(
        "m-from-the-server",
      ),
    );
  });

  it("reads the turns, tokens and cost Bay sent with the job's end before the log's (#Q4293)", async ({
    expect,
  }) => {
    world.jobs = [
      job({
        id: DONE,
        status: "succeeded",
        exitCode: 0,
        input: { agent: "claude", prompt: "Triage" } as never,
        turns: 7,
        inputTokens: 48_120,
        outputTokens: 2_100,
        costUsd: 0.4213,
      }),
    ];
    world.logs = {
      // A log whose own result line says otherwise: the job's columns win.
      [DONE]: {
        stdout: JSON.stringify({
          type: "result",
          num_turns: 1,
          total_cost_usd: 9.99,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        stderr: "",
        live: false,
      },
    };
    await show(DONE);
    const page = screen.getByTestId("project-job");
    await waitFor(() => expect(page.textContent).toContain("$0.42"));
    expect(page.textContent).toContain("48,120");
    expect(page.textContent).not.toContain("$9.99");
  });

  it("cuts a long line of an agent CLI with no parser at 500 characters, with a button for the rest (#Q4323)", async ({
    expect,
  }) => {
    const blob = "iVBORw0KGgo".repeat(200);
    world.jobs = [
      job({
        status: "succeeded",
        input: { profile: "read", agent: "gemini" } as never,
      }),
    ];
    world.logs = {
      [RUNNING]: { stdout: `${blob}\n`, stderr: "", live: false },
    };
    await show(RUNNING);
    const raw = await screen.findByTestId("job-raw-line");
    expect(raw.textContent).toHaveLength(501);
    fireEvent.click(
      screen.getByText(`Show ${blob.length - 500} more characters`),
    );
    expect(screen.getByTestId("job-raw-line").textContent).toBe(blob);
    expect(screen.getByText("Show less")).toBeTruthy();
  });

  it("never draws a Claude Code line it cannot read (#Q4296)", async ({
    expect,
  }) => {
    world.jobs = [job({ status: "succeeded" })];
    world.logs = {
      [RUNNING]: {
        stdout: `${JSON.stringify({ type: "odd_event" })}\nnot json at all\n${JSON.stringify(
          {
            type: "assistant",
            message: { content: [{ type: "text", text: "All green." }] },
          },
        )}\n`,
        stderr: "",
        live: false,
      },
    };
    await show(RUNNING);
    const events = await screen.findByTestId("job-events");
    await waitFor(() => expect(events.textContent).toContain("All green."));
    expect(screen.queryByTestId("job-raw-line")).toBeNull();
    expect(events.textContent).not.toContain("odd_event");
    expect(events.textContent).not.toContain("not json");
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

  it("animates a running job, and offers Download log and Cancel, last and destructive, in its … menu (#Q4403, #Q4448)", async ({
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
    // The three actions are not buttons of the toolbar any more.
    expect(screen.queryByRole("button", { name: /Download log/ })).toBeNull();
    expect(screen.queryByTestId("job-cancel")).toBeNull();
    const more = screen.getByTestId("job-more");
    expect(more.getAttribute("aria-label")).toBe("More actions");
    fireEvent.click(more);
    await screen.findAllByRole("menuitem");
    const items = screen.getAllByRole("menuitem");
    // No Copy prompt: this job carries no prompt.
    expect(items.map((it) => it.textContent)).toEqual([
      "Download log",
      "Cancel",
    ]);
    const cancel = screen.getByTestId("job-cancel");
    expect(cancel.getAttribute("data-variant")).toBe("destructive");
    expect(screen.queryByTestId("job-log")).toBeNull();

    // The trigger is a minimal button, and a separator stands before
    // Cancel (#Q4493).
    expect(more.className).toContain("hover:bg-hover");
    expect(more.className).not.toContain("bg-transparent");
    expect(cancel.previousElementSibling?.getAttribute("data-slot")).toBe(
      "dropdown-menu-separator",
    );

    // Cancel asks first: dismissed, the job is left running (#Q4493).
    world.calls = [];
    fireEvent.click(cancel);
    const ask = await screen.findByRole("alertdialog");
    expect(ask.textContent).toContain("Cancel this job?");
    fireEvent.click(screen.getByRole("button", { name: "Keep it running" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(world.calls).not.toContain("cancelJob");

    // Confirmed, the menu item cancels the job.
    fireEvent.click(screen.getByTestId("job-more"));
    fireEvent.click(await screen.findByTestId("job-cancel"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel the job" }));
    await waitFor(() => expect(world.calls).toContain("cancelJob"));
  });

  it("says a running job's log is full and the job still runs, and only that its log was cut once it ended (#Q4455)", async ({
    expect,
  }) => {
    world.jobs = [job({ logTruncated: true })];
    world.logs = {
      [RUNNING]: { stdout: "cloning\n", stderr: "", live: true },
    };
    await show(RUNNING);
    const full = await screen.findByTestId("job-log-full");
    expect(full.textContent).toContain("the job is still running");

    cleanup();
    await alepha?.stop();
    world.jobs = [job({ id: DONE, status: "succeeded", logTruncated: true })];
    world.logs = { [DONE]: { stdout: "cloning\n", stderr: "", live: false } };
    await show(DONE);
    await screen.findByText(/The log was cut/);
    expect(screen.queryByTestId("job-log-full")).toBeNull();
  });

  it("offers Poke on a running job whose agent reads messages, sends Wake up or a message, and names who sent each (#Q4456)", async ({
    expect,
  }) => {
    const user = (content: string) =>
      JSON.stringify({ type: "user", message: { role: "user", content } });
    world.pokes = [];
    world.jobs = [
      job({
        pokeable: true,
        pokes: [
          {
            at: "2026-11-23T10:05:00.000Z",
            by: "00000000-0000-4000-8000-0000000000bb",
            byName: "alice",
            message: "Read the state yourself.",
            status: "done",
          },
        ],
      }),
    ];
    world.logs = {
      [RUNNING]: {
        stdout: `${user("Triage the inbox.")}\n${user("Read the state yourself.")}\n`,
        stderr: "",
        live: true,
      },
    };
    await show(RUNNING);

    const said = await screen.findByTestId("job-poke-message");
    expect(said.textContent).toContain("Poke from alice");
    expect(said.textContent).toContain("Read the state yourself.");

    fireEvent.click(screen.getByTestId("job-more"));
    fireEvent.click(await screen.findByTestId("job-poke"));
    await screen.findByTestId("job-poke-dialog");
    expect(screen.getByTestId("job-poke-preset").textContent).toContain(
      "background watchers",
    );
    fireEvent.click(screen.getByTestId("job-poke-send"));
    await waitFor(() => expect(world.pokes).toHaveLength(1));
    expect(world.pokes[0]).toContain("background watchers");
  });

  it("names a poke by the one that reached the agent, never a refused one, and shows no user line no poke sent (#Q4456)", async ({
    expect,
  }) => {
    const user = (content: string) =>
      JSON.stringify({ type: "user", message: { role: "user", content } });
    world.jobs = [
      job({
        pokeable: true,
        pokes: [
          {
            at: "2026-11-23T10:04:00.000Z",
            byName: "alice",
            message: "Wake up.",
            status: "failed",
            reason: "the job is finishing",
          },
          {
            at: "2026-11-23T10:05:00.000Z",
            byName: "bob",
            message: "Wake up.",
            status: "done",
          },
        ],
      }),
    ];
    world.logs = {
      [RUNNING]: {
        stdout: [
          user("Triage the inbox."),
          user("Wake up."),
          user("A line Claude Code wrote itself."),
          "",
        ].join("\n"),
        stderr: "",
        live: true,
      },
    };
    await show(RUNNING);
    const said = await screen.findAllByTestId("job-poke-message");
    expect(said).toHaveLength(1);
    expect(said[0]?.textContent).toContain("Poke from bob");
    expect(screen.queryByText("A line Claude Code wrote itself.")).toBeNull();
  });

  it("offers no Poke on a job whose agent or host reads no message (#Q4456)", async ({
    expect,
  }) => {
    world.jobs = [job({})];
    world.logs = { [RUNNING]: { stdout: "", stderr: "", live: true } };
    await show(RUNNING);
    fireEvent.click(screen.getByTestId("job-more"));
    await screen.findAllByRole("menuitem");
    expect(screen.queryByTestId("job-poke")).toBeNull();
  });

  it("offers Copy prompt for a job with a prompt, and no Cancel once it has ended (#Q4448)", async ({
    expect,
  }) => {
    world.jobs = [
      job({
        id: DONE,
        status: "succeeded",
        exitCode: 0,
        input: { agent: "claude", prompt: "Triage" } as never,
      }),
    ];
    world.logs = { [DONE]: { stdout: "", stderr: "", live: false } };
    await show(DONE);

    fireEvent.click(await screen.findByTestId("job-more"));
    await screen.findAllByRole("menuitem");
    expect(screen.getAllByRole("menuitem").map((it) => it.textContent)).toEqual(
      ["Download log", "Copy prompt"],
    );
    expect(screen.queryByTestId("job-cancel")).toBeNull();
  });

  it("opens the transcript for a stale ?tab=log, from when the page had a Raw log tab (#Q4403)", async ({
    expect,
  }) => {
    world.jobs = [job({ id: DONE, status: "succeeded", exitCode: 0 })];
    world.logs = { [DONE]: { stdout: "", stderr: "", live: false } };
    window.history.replaceState({}, "", "/?tab=log");
    await show(DONE);
    expect(await screen.findByTestId("job-transcript")).toBeTruthy();
    window.history.replaceState({}, "", "/");
  });
});
