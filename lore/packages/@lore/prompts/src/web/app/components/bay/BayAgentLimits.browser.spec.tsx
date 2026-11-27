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

import BayAgentLimits from "./BayAgentLimits.tsx";

const HOST = {
  id: "00000000-0000-4000-8000-0000000000aa",
  slug: "box-1",
  type: "bay",
  online: true,
  overdue: false,
  deployAllowed: false,
  jobsAllowed: true,
  agentHost: true,
  agentStatus: "available",
  collectSeries: false,
  statsIntervalSeconds: 1800,
  acceptedRuntimes: ["node"],
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  project: { id: 1, title: "Acme", slug: "acme" },
  can: [],
  projects: [],
  jobsRunning: 0,
  jobsMaxJobs: 1,
  jobsMaxReadJobs: 8,
};

const COMMAND = "00000000-0000-4000-8000-0000000000c1";

/**
 * What the fake server holds: the answer to the enqueue (a command or a
 * refusal), and the limits the host reports once it wrote them.
 */
const world = {
  enqueue: async (_body: Record<string, unknown>): Promise<unknown> => ({}),
  sent: [] as Record<string, unknown>[],
  commands: [] as unknown[],
  reported: { jobsMaxJobs: 1, jobsMaxReadJobs: 8 },
};

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      enqueueHostCommand: async ({
        body,
      }: {
        body: Record<string, unknown>;
      }) => {
        world.sent.push(body);
        return world.enqueue(body);
      },
      listHostCommands: async () => ({ items: world.commands }),
      getHost: async () => ({ ...HOST, ...world.reported }),
    });
  }
}

/**
 * An Agent host's two limits (#Q4543): shown as labelled values, editable by
 * a member who may update the host, sent to Bay as a command, and the
 * host's answer said on the control.
 */
describe("BayAgentLimits", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    world.sent = [];
    world.commands = [];
    world.reported = { jobsMaxJobs: 1, jobsMaxReadJobs: 8 };
  });

  const show = async (canUpdate: boolean) => {
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
    alepha.store.set(currentHostAtom, HOST as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <BayAgentLimits canUpdate={canUpdate} />
      </AlephaContext.Provider>,
    );
  };

  const edit = (maxJobs: string, maxReadJobs: string) => {
    const open = screen.queryByTestId("bay-agent-limits-edit");
    if (open) fireEvent.click(open);
    const input = (id: string) =>
      screen.getByTestId(id).querySelector("input") as HTMLInputElement;
    fireEvent.change(input("bay-agent-limits-max-jobs"), {
      target: { value: maxJobs },
    });
    fireEvent.change(input("bay-agent-limits-max-read-jobs"), {
      target: { value: maxReadJobs },
    });
  };

  it("shows both limits as labelled values, with no edit for a member who may not update the host", async ({
    expect,
  }) => {
    await show(false);
    expect(
      screen.getByTestId("bay-agent-limits-max-jobs-value").textContent,
    ).toBe("1");
    expect(
      screen.getByTestId("bay-agent-limits-max-read-jobs-value").textContent,
    ).toBe("8");
    expect(screen.getByTestId("bay-agent-limits").textContent).toContain(
      "Jobs that change code at once",
    );
    expect(screen.queryByTestId("bay-agent-limits-edit")).toBeNull();
  });

  it("sends the new limits, and shows the host's values once it answered", async ({
    expect,
  }) => {
    world.enqueue = async () => ({ id: COMMAND, status: "pending" });
    world.commands = [{ id: COMMAND, status: "done" }];
    world.reported = { jobsMaxJobs: 2, jobsMaxReadJobs: 6 };
    await show(true);
    edit("2", "6");
    fireEvent.click(screen.getByTestId("bay-agent-limits-save"));
    await waitFor(() =>
      expect(screen.getByTestId("bay-agent-limits-state").dataset.state).toBe(
        "done",
      ),
    );
    expect(world.sent).toEqual([
      { kind: "jobs-limits", maxJobs: 2, maxReadJobs: 6 },
    ]);
    expect(
      screen.getByTestId("bay-agent-limits-max-jobs-value").textContent,
    ).toBe("2");
    expect(
      screen.getByTestId("bay-agent-limits-max-read-jobs-value").textContent,
    ).toBe("6");
  });

  it("sends only the limit that changed, and none out of 1 to 16", async ({
    expect,
  }) => {
    world.enqueue = async () => ({ id: COMMAND, status: "pending" });
    await show(true);
    edit("17", "6");
    fireEvent.click(screen.getByTestId("bay-agent-limits-save"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(world.sent).toEqual([]);
    edit("1", "6");
    fireEvent.click(screen.getByTestId("bay-agent-limits-save"));
    await waitFor(() =>
      expect(world.sent).toEqual([{ kind: "jobs-limits", maxReadJobs: 6 }]),
    );
  });

  it("says to upgrade Bay when the host does not know the command", async ({
    expect,
  }) => {
    world.enqueue = async () => ({ id: COMMAND, status: "pending" });
    world.commands = [
      {
        id: COMMAND,
        status: "failed",
        reason:
          'unknown action "jobs-limits": this bay runs restart, deploy, nothing else',
      },
    ];
    await show(true);
    edit("2", "6");
    fireEvent.click(screen.getByTestId("bay-agent-limits-save"));
    await waitFor(() =>
      expect(screen.getByTestId("bay-agent-limits-state").dataset.state).toBe(
        "failed",
      ),
    );
    expect(screen.getByTestId("bay-agent-limits-state").textContent).toContain(
      "Upgrade Bay",
    );
  });

  it("says a refusal on the control, as the server worded it", async ({
    expect,
  }) => {
    world.enqueue = async () => {
      throw new Error('Host "box-1" is not connected right now');
    };
    await show(true);
    edit("2", "6");
    fireEvent.click(screen.getByTestId("bay-agent-limits-save"));
    await waitFor(() =>
      expect(
        screen.getByTestId("bay-agent-limits-state").textContent,
      ).toContain("not connected right now"),
    );
  });
});
