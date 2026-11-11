import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import type { JobStepView } from "alepha/api/jobs";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AdminJobExecutionSteps,
  type AdminJobExecutionStepsProps,
} from "../AdminJobExecutionSteps.tsx";

const three: JobStepView[] = [
  {
    name: "capture",
    at: "2026-11-11T10:00:00.000Z",
    ms: 42,
    hasResult: true,
    resultPreview: JSON.stringify({ charge: "ch_1" }, null, 2),
  },
  {
    name: "invoice",
    at: "2026-11-11T10:00:01.000Z",
    ms: 1500,
    hasResult: false,
  },
  {
    name: "cool-off",
    at: "2026-11-11T10:00:02.000Z",
    ms: 0,
    until: "2099-01-01T00:00:00.000Z",
    hasResult: false,
  },
];

describe("AdminJobExecutionSteps", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (props: AdminJobExecutionStepsProps) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminJobExecutionSteps {...props} />
      </AlephaContext.Provider>,
    );
  };

  it("draws nothing for a run without steps", async () => {
    const view = await mount({ steps: [], status: "ok" });
    expect(view.container.innerHTML).toBe("");
    const none = await mount({ status: "ok" });
    expect(none.container.innerHTML).toBe("");
  });

  it("lists three steps in order, with duration and a result disclosure", async () => {
    const view = await mount({ steps: three, status: "ok" });
    const rows = view.container.querySelectorAll("li[data-step]");
    expect([...rows].map((r) => r.getAttribute("data-step"))).toEqual([
      "capture",
      "invoice",
      "cool-off",
    ]);
    expect(screen.getByText(/42 ms/)).toBeTruthy();
    expect(screen.getByText(/1\.5 s/)).toBeTruthy();
    // The sleep of a finished run is in the past.
    expect(screen.getByText(/^Slept until /)).toBeTruthy();
    // One result, behind its disclosure.
    const trigger = screen.getByRole("button", { name: /Result/ });
    expect(screen.getAllByRole("button", { name: /Result/ })).toHaveLength(1);
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText(/"ch_1"/)).toBeTruthy());
  });

  it("shows a scheduled run's last sleep as the wait it is in", async () => {
    await mount({ steps: three, status: "scheduled" });
    expect(screen.getByText(/^Waiting until .*\(in .*\)$/)).toBeTruthy();
    expect(screen.queryByText(/^Slept until /)).toBeNull();
  });

  it("shows a failed run's error under the last step it completed", async () => {
    const view = await mount({
      steps: three.slice(0, 2),
      status: "error",
      error: "mailer refused the receipt",
    });
    const failure = view.container.querySelector("li[data-step-failure]");
    expect(failure?.textContent).toContain("Failed after invoice");
    expect(failure?.textContent).toContain("mailer refused the receipt");
    const items = [...view.container.querySelectorAll("li")];
    expect(items[items.length - 1]).toBe(failure);
  });
});
