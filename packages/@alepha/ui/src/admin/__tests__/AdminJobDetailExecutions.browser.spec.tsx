import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { JobExecutionRow } from "alepha/api/jobs";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../../core/Toaster.tsx";
import { DialogProvider } from "../../core/useDialog.tsx";
import { AdminJobDetailExecutions } from "../AdminJobDetailExecutions.tsx";

const row = (id: string, status: JobExecutionRow["status"]): JobExecutionRow =>
  ({
    id,
    jobName: "deploys.run",
    status,
    attempt: 1,
    maxAttempts: 1,
    redispatchCount: 0,
    createdAt: "2026-09-13T10:00:00.000Z",
    updatedAt: "2026-09-13T10:00:00.000Z",
    can: {
      retry: status === "error" || status === "cancelled",
      cancel: status === "running" || status === "pending",
      delete: status === "ok" || status === "error" || status === "cancelled",
    },
  }) as JobExecutionRow;

const ROWS = [
  row("00000000-0000-4000-8000-000000000001", "error"),
  row("00000000-0000-4000-8000-000000000002", "running"),
];

/**
 * A fake admin API. `granted` is the caller's side of every gate: what each
 * action's `can()` answers.
 */
class Links extends LinkProvider {
  public granted: Record<string, boolean> = {};
  public bulkBodies: string[][] = [];

  override client(): any {
    const actions: Record<string, any> = {
      listExecutions: async () => ({
        content: ROWS,
        page: {
          number: 0,
          size: 10,
          offset: 0,
          numberOfElements: ROWS.length,
          totalElements: ROWS.length,
          totalPages: 1,
          isEmpty: false,
          isFirst: true,
          isLast: true,
        },
      }),
      deleteExecutions: async (input: any) => {
        this.bulkBodies.push(input.body.ids);
        return { deleted: 1, skipped: 1 };
      },
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => ({}));
        action.can = () => this.granted[key] ?? true;
        return action;
      },
    });
  }
}

/**
 * The job page's executions table: every row action is gated twice, on the
 * row's status and on the caller's permission, and a bulk delete says how many
 * rows it deleted and how many it skipped.
 */
describe("AdminJobDetailExecutions", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (granted: Record<string, boolean> = {}) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    const links = alepha.inject(Links);
    links.granted = granted;
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <AdminJobDetailExecutions jobName="deploys.run" onOpen={() => {}} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Failed")).toBeTruthy());
    return links;
  };

  const menuOf = async (status: string) => {
    const tr = screen.getByText(status).closest("tr") as HTMLElement;
    fireEvent.click(
      tr.querySelector('button[aria-label="Open row actions"]') as HTMLElement,
    );
    const items = await waitFor(() => {
      const found = document.querySelectorAll('[role="menuitem"]');
      expect(found.length).toBeGreaterThan(0);
      return Array.from(found).map((item) => item.textContent);
    });
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0),
    );
    return items;
  };

  it("offers each action where the row allows it", async () => {
    await mount();

    const failed = await menuOf("Failed");
    expect(failed).toEqual(expect.arrayContaining(["View", "Retry", "Delete"]));
    expect(failed).not.toContain("Cancel");

    const running = await menuOf("Running");
    expect(running).toEqual(expect.arrayContaining(["View", "Cancel"]));
    expect(running).not.toContain("Delete");
    expect(running).not.toContain("Retry");
  });

  it("withholds an action the caller may not take, whatever the row allows", async () => {
    await mount({
      deleteExecution: false,
      retryExecution: false,
      cancelExecution: false,
    });

    expect(await menuOf("Failed")).toEqual(["View"]);
    expect(await menuOf("Running")).toEqual(["View"]);
  });

  it("reports both counts of a bulk delete", async () => {
    const links = await mount();

    // The first checkbox is the header's select-all.
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(
      await waitFor(() =>
        screen.getByRole("button", { name: "Delete selected" }),
      ),
    );
    fireEvent.click(
      await waitFor(() => screen.getByRole("button", { name: "Confirm" })),
    );

    await waitFor(() =>
      expect(screen.getByText("1 deleted, 1 skipped")).toBeTruthy(),
    );
    expect(links.bulkBodies).toEqual([ROWS.map((r) => r.id)]);
  });

  it("offers no bulk delete to a caller who may not delete", async () => {
    await mount({ deleteExecutions: false });

    // No bulk action at all, so no selection column to pick rows with.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Delete selected" }),
    ).toBeNull();
  });
});
