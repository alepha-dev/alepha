import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { JobRegistration } from "alepha/api/jobs";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminJobs, jobDomain, matchesJobFilters } from "../AdminJobs.tsx";

const JOBS: JobRegistration[] = [
  {
    name: "system.users.purge-expired-sessions",
    description: "Deletes sessions past their expiry date.",
    type: "cron",
    cron: "0 * * * *",
    retention: {
      ok: { last: 24 },
      error: { days: 30 },
      source: { ok: "default", error: "default" },
      cadence: "hourly",
    },
    recent: {
      ok: 3,
      error: 0,
      lastRun: "2026-09-13T10:00:00.000Z",
      lastStatus: "ok",
    },
  },
  {
    name: "deploys.run",
    description: "Runs one deployment.",
    type: "queue",
    retention: {
      ok: { days: 30 },
      error: { days: 30 },
      source: { ok: "job", error: "job" },
    },
    recent: {
      ok: 2,
      error: 1,
      lastRun: "2026-09-13T11:00:00.000Z",
      lastStatus: "error",
    },
  },
  {
    name: "images.make-thumbnail",
    description: "Generates a thumbnail.",
    type: "direct",
    retention: {
      ok: false,
      error: { days: 30 },
      source: { ok: "default", error: "default" },
    },
    recent: { ok: 0, error: 0 },
  },
];

/**
 * The job registry, as a fake server. `canTrigger` is what
 * `triggerJob.can()` answers: the caller's right to trigger.
 */
class Links extends LinkProvider {
  public canTrigger = true;

  override client(): any {
    const actions: Record<string, any> = {
      listJobs: async () => JOBS,
      triggerJob: async () => ({ ok: true }),
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => ({}));
        action.can = () => (key === "triggerJob" ? this.canTrigger : true);
        return action;
      },
    });
  }
}

/**
 * The admin jobs list, per the owner's notes on #E55: the type is an icon on
 * the name, a schedule-less job shows no schedule at all, the retention rule
 * is printed so a cron with one kept row does not read as broken, and
 * "Trigger now" is offered only where it can work.
 */
describe("AdminJobs", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (canTrigger = true) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(Links).canTrigger = canTrigger;
    await alepha.start();
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <AdminJobs />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("deploys.run")).toBeTruthy());
    return view;
  };

  const rowOf = (name: string) =>
    screen.getByText(name).closest("tr") as HTMLTableRowElement;

  const rowMenuItems = async (name: string) => {
    const trigger = rowOf(name).querySelector(
      'button[aria-label="Open row actions"]',
    ) as HTMLButtonElement;
    fireEvent.click(trigger);
    return await waitFor(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      expect(items.length).toBeGreaterThan(0);
      return Array.from(items).map((item) => item.textContent);
    });
  };

  it("marks each job's type with an icon named by what the type means", async () => {
    await mount();

    const icon = (name: string) =>
      rowOf(name).querySelector("[data-job-type]") as HTMLElement;
    expect(icon("system.users.purge-expired-sessions").dataset.jobType).toBe(
      "cron",
    );
    expect(
      screen.getByRole("img", { name: "Scheduled, runs on its cron" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "Queued, runs when pushed, through the queue",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Runs in process when pushed" }),
    ).toBeTruthy();
    // No Type column any more.
    expect(screen.queryByRole("columnheader", { name: /^Type$/ })).toBeNull();
  });

  it("prints a cron's schedule and nothing at all for a pushed job", async () => {
    await mount();

    expect(
      rowOf("system.users.purge-expired-sessions").querySelector("code")
        ?.textContent,
    ).toBe("0 * * * *");
    for (const name of ["deploys.run", "images.make-thumbnail"]) {
      const row = rowOf(name);
      expect(row.querySelector("code")).toBeNull();
      expect(row.textContent).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("prints the retention rule, marks a default, and explains it in full", async () => {
    await mount();

    const cron = rowOf("system.users.purge-expired-sessions");
    expect(cron.textContent).toContain("OK: last 24 · Errors: 30 days");
    expect(cron.textContent).toContain("default");
    const phrase = Array.from(cron.querySelectorAll("[title]")).find((el) =>
      el.getAttribute("title")?.startsWith("Successes"),
    );
    expect(phrase?.getAttribute("title")).toBe(
      "Successes: last 24. Failures and cancellations: 30 days. Default for a job that runs up to hourly.",
    );

    const declared = rowOf("deploys.run");
    expect(declared.textContent).toContain("OK: 30 days · Errors: 30 days");
    expect(declared.textContent).not.toContain("default");

    expect(rowOf("images.make-thumbnail").textContent).toContain(
      "OK: not kept · Errors: 30 days",
    );
  });

  it("says in the OK and Errors headers that they count kept rows", async () => {
    await mount();

    for (const header of ["OK", "Errors"]) {
      const th = screen
        .getAllByRole("columnheader")
        .find((cell) => cell.textContent?.trim() === header);
      expect(th?.getAttribute("title")).toMatch(/still kept, not every run/);
    }
  });

  it("offers Trigger now on a cron only, and only to a caller who may trigger", async () => {
    await mount();

    expect(await rowMenuItems("system.users.purge-expired-sessions")).toContain(
      "Trigger now",
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0),
    );
    expect(await rowMenuItems("deploys.run")).not.toContain("Trigger now");
  });

  it("hides Trigger now from a caller without the right to trigger", async () => {
    await mount(false);

    const items = await rowMenuItems("system.users.purge-expired-sessions");
    expect(items).not.toContain("Trigger now");
    expect(items).toContain("View executions");
  });
});

describe("the admin jobs filters", () => {
  const byName = (name: string) => JOBS.find((j) => j.name === name)!;
  const kept = (filters: Parameters<typeof matchesJobFilters>[1]) =>
    JOBS.filter((job) => matchesJobFilters(job, filters)).map((j) => j.name);

  it("reads a job's domain past the system. prefix", () => {
    expect(jobDomain("system.users.purge-expired-sessions")).toBe("users");
    expect(jobDomain("deploys.run")).toBe("deploys");
  });

  it("filters by origin", () => {
    expect(kept({ origin: "system" })).toEqual([
      "system.users.purge-expired-sessions",
    ]);
    expect(kept({ origin: "app" })).toEqual([
      "deploys.run",
      "images.make-thumbnail",
    ]);
  });

  it("filters by domain", () => {
    expect(kept({ domain: "users" })).toEqual([
      "system.users.purge-expired-sessions",
    ]);
    expect(kept({ domain: "images" })).toEqual(["images.make-thumbnail"]);
  });

  it("filters by health", () => {
    expect(kept({ health: "lastFailed" })).toEqual(["deploys.run"]);
    expect(kept({ health: "hasFailures" })).toEqual(["deploys.run"]);
    expect(kept({ health: "noRuns" })).toEqual(["images.make-thumbnail"]);
  });

  it("filters by type and by a search over name and description", () => {
    expect(kept({ type: "direct" })).toEqual(["images.make-thumbnail"]);
    expect(kept({ search: "DEPLOYMENT" })).toEqual(["deploys.run"]);
    expect(matchesJobFilters(byName("deploys.run"), {})).toBe(true);
  });
});
