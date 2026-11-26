import { DialogProvider } from "@alepha/ui";
import type { HostMachineJob } from "@lore/core/schemas";
import { virtualClientFake } from "@lore/core/testing";
import { I18n, currentHostAtom } from "@lore/core/web";
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

import BayJobs from "./BayJobs.tsx";

const HOST = "00000000-0000-4000-8000-0000000000aa";
const OURS = "00000000-0000-4000-8000-000000000001";
const THEIRS = "00000000-0000-4000-8000-000000000002";

const JOBS: HostMachineJob[] = [
  {
    id: THEIRS,
    kind: "agent",
    status: "running",
    queuedAt: "2026-11-26T11:00:00.000Z",
    startedAt: "2026-11-26T11:00:05.000Z",
    project: { id: 2, title: "Crm", slug: "crm" },
    readable: false,
    inputTokens: 1200,
    outputTokens: 300,
  },
  {
    id: OURS,
    kind: "agent",
    status: "succeeded",
    queuedAt: "2026-11-26T10:00:00.000Z",
    startedAt: "2026-11-26T10:00:00.000Z",
    endedAt: "2026-11-26T10:01:12.000Z",
    project: { id: 1, title: "Acme", slug: "acme" },
    readable: true,
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
    startedByName: "ada",
  },
];

const world = { calls: [] as Array<{ action: string; params: unknown }> };

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      listHostJobs: async (request: { params: unknown }) => {
        world.calls.push({ action: "listHostJobs", params: request.params });
        return { items: JOBS };
      },
      cancelHostJob: async (request: { params: unknown }) => {
        world.calls.push({ action: "cancelHostJob", params: request.params });
        return { ...JOBS[0], status: "cancelled" };
      },
    });
  }
}

/**
 * The Jobs tab of a host's console (#Q4524): every job of the machine, a
 * job of a project the reader cannot read drawn without a link or a prompt.
 */
describe("BayJobs", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    world.calls = [];
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (can: string[]) => {
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
    alepha.store.set(currentHostAtom, {
      id: HOST,
      slug: "box-1",
      type: "bay",
      online: true,
      overdue: false,
      deployAllowed: false,
      jobsAllowed: true,
      agentHost: true,
      collectSeries: false,
      statsIntervalSeconds: 1800,
      acceptedRuntimes: ["node"],
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      project: { id: 1, title: "Acme", slug: "acme" },
      can,
      projects: [],
    } as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <BayJobs />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await waitFor(() => {
      if (screen.queryAllByTestId("host-job-project").length !== 2) {
        throw new Error("jobs not listed yet");
      }
    });
  };

  const rowOf = (project: string) => {
    const cell = screen
      .getAllByTestId("host-job-project")
      .find((it) => it.textContent === project);
    const row = cell?.closest("tr");
    if (!row) throw new Error(`no row for ${project}`);
    return row;
  };

  it("lists every job of the host with its project, asked for by the host's id", async ({
    expect,
  }) => {
    await show(["host:read"]);
    expect(
      screen.getAllByTestId("host-job-project").map((it) => it.textContent),
    ).toEqual(["Crm", "Acme"]);
    expect(world.calls[0]).toEqual({
      action: "listHostJobs",
      params: { hostId: HOST },
    });
  });

  it("links a readable job to its page in its own project, with its prompt and args", async ({
    expect,
  }) => {
    await show(["host:read"]);
    const row = rowOf("Acme");
    expect(row.querySelector("a")?.getAttribute("href")).toBe(
      `/acme/jobs/${OURS}`,
    );
    expect(row.textContent).toContain("work-quest");
    expect(row.textContent).toContain("#Q12 Fix the cart");
    expect(row.textContent).toContain("1 min 12 s");
  });

  it("draws a job of a project the reader cannot read with no link and no prompt", async ({
    expect,
  }) => {
    await show(["host:read"]);
    const row = rowOf("Crm");
    expect(row.querySelector("a")).toBeNull();
    expect(row.querySelector("[data-testid=host-job-what]")?.textContent).toBe(
      "agent",
    );
    // What the machine knows is still there.
    expect(
      row
        .querySelector("[data-testid=job-status]")
        ?.getAttribute("data-status"),
    ).toBe("running");
    expect(row.textContent).toContain("1,200 / 300");
  });

  it("offers no Cancel to a reader without host:update", async ({ expect }) => {
    await show(["host:read"]);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("cancels a job in flight, another project's included, once confirmed, for host:update", async ({
    expect,
  }) => {
    await show(["host:read", "host:update"]);
    // Only the running job: the ended one has nothing to stop.
    const buttons = screen.getAllByRole("button", { name: "Cancel" });
    expect(buttons).toHaveLength(1);
    expect(rowOf("Crm").contains(buttons[0]!)).toBe(true);
    fireEvent.click(buttons[0]!);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel the job" }));
    await waitFor(() =>
      expect(world.calls).toContainEqual({
        action: "cancelHostJob",
        params: { hostId: HOST, jobId: THEIRS },
      }),
    );
  });
});
