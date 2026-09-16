import { render, screen, waitFor, within } from "@testing-library/react";
import { Alepha } from "alepha";
import type { JobExecutionResource } from "alepha/api/jobs";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminJobExecutionSheet } from "../AdminJobExecutionSheet.tsx";

const failed: JobExecutionResource = {
  id: "0192bbbb-0000-7000-8000-000000000001",
  jobName: "system.notifications.send",
  status: "error",
  attempt: 4,
  maxAttempts: 4,
  redispatchCount: 0,
  key: "welcome-42",
  payload: { contact: "ada@alepha.dev" },
  error: `SMTP refused the connection\n  at Mailer.send (mailer.ts:12)\n  at Job.run (job.ts:7)`,
  logs: [
    {
      level: "INFO",
      message: "Sending welcome email",
      service: "api",
      module: "notifications",
      timestamp: Date.parse("2026-09-13T10:00:00.000Z"),
    },
    {
      level: "ERROR",
      message: "Provider answered 550",
      service: "api",
      module: "mail",
      timestamp: Date.parse("2026-09-13T10:00:01.000Z"),
      data: { code: 550 },
    },
  ],
  startedAt: "2026-09-13T10:00:00.000Z",
  completedAt: "2026-09-13T10:00:02.500Z",
  createdAt: "2026-09-13T09:59:59.000Z",
  updatedAt: "2026-09-13T10:00:02.500Z",
  triggeredByName: "Ada Lovelace",
  can: { retry: true, cancel: false, delete: true },
} as JobExecutionResource;

/**
 * Serves `getExecution` from a queue of answers, the last one repeating, and
 * counts the reads.
 */
class Links extends LinkProvider {
  public answers: JobExecutionResource[] = [failed];
  public reads = 0;

  override client(): any {
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any =
          key === "getExecution"
            ? async () => {
                const answer =
                  this.answers[Math.min(this.reads, this.answers.length - 1)];
                this.reads++;
                return answer;
              }
            : async () => ({});
        action.can = () => true;
        return action;
      },
    });
  }
}

describe("AdminJobExecutionSheet", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (answers: JobExecutionResource[]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    const links = alepha.inject(Links);
    links.answers = answers;
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <AdminJobExecutionSheet
          executionId={answers[0].id}
          onClose={() => {}}
          pollMs={20}
        />
      </AlephaContext.Provider>,
    );
    return links;
  };

  it("shows the overview, the error in full, the logs as lines and the payload", async () => {
    await mount([failed]);

    const drawer = await waitFor(() => screen.getByRole("dialog"));
    await waitFor(() =>
      expect(within(drawer).getByText("Ada Lovelace")).toBeTruthy(),
    );
    expect(within(drawer).getByText("4/4")).toBeTruthy();
    expect(within(drawer).getByText("welcome-42")).toBeTruthy();
    expect(within(drawer).getByText("2.5 s")).toBeTruthy();

    // The whole error, stack included, not a two-line clamp.
    const error = within(drawer).getByText(/at Job\.run \(job\.ts:7\)/);
    expect(error.textContent).toContain("SMTP refused the connection");

    // Lines, not a JSON dump: one list item per entry, level first.
    const lines = within(
      within(drawer).getByRole("list", { name: "Logs" }),
    ).getAllByRole("listitem");
    expect(lines).toHaveLength(2);
    expect(lines[1].dataset.level).toBe("ERROR");
    expect(lines[1].textContent).toContain("Provider answered 550");
    expect(lines[1].textContent).toContain('"code": 550');

    expect(
      within(drawer).getByText(/"contact": "ada@alepha\.dev"/),
    ).toBeTruthy();
  });

  it("re-reads a run in progress until it ends, and says the logs come at the end", async () => {
    const running = {
      ...failed,
      status: "running",
      completedAt: undefined,
      error: undefined,
      logs: undefined,
      can: { retry: false, cancel: true, delete: false },
    } as JobExecutionResource;
    const done = {
      ...failed,
      status: "ok",
      error: undefined,
      can: { retry: false, cancel: false, delete: true },
    } as JobExecutionResource;
    const links = await mount([running, running, done]);

    const drawer = await waitFor(() => screen.getByRole("dialog"));
    await waitFor(() =>
      expect(
        within(drawer).getByText("The logs arrive when the run ends."),
      ).toBeTruthy(),
    );

    await waitFor(() =>
      expect(within(drawer).getByText("Succeeded")).toBeTruthy(),
    );
    expect(
      within(drawer).queryByText("The logs arrive when the run ends."),
    ).toBeNull();
    expect(within(drawer).getByText("Sending welcome email")).toBeTruthy();

    // It stops at the terminal status rather than polling forever.
    const readsAtEnd = links.reads;
    await new Promise((r) => setTimeout(r, 120));
    expect(links.reads).toBe(readsAtEnd);
    expect(readsAtEnd).toBe(3);
  });

  it("says so in one line when a finished run kept no log", async () => {
    await mount([{ ...failed, status: "ok", error: undefined, logs: [] }]);

    const drawer = await waitFor(() => screen.getByRole("dialog"));
    await waitFor(() =>
      expect(
        within(drawer).getByText("This run kept no log entries."),
      ).toBeTruthy(),
    );
  });
});
