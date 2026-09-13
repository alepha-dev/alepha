import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { JobExecutionResource } from "alepha/api/jobs";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdminJobsPayloadDialog } from "../admin-jobs-payload-dialog.tsx";

/**
 * A job that reschedules itself through stages carries the stage in its
 * payload, and this dialog is the one place the admin can read it. What it
 * pins: the payload is printed whole while an execution is set, and nothing
 * renders once cleared.
 */
describe("AdminJobsPayloadDialog", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const parked: JobExecutionResource = {
    id: "0192aaaa-0000-7000-8000-000000000001",
    jobName: "CartRecoveryJobs.cartRecovery",
    status: "scheduled",
    priority: "normal",
    attempt: 0,
    maxAttempts: 4,
    redispatchCount: 0,
    key: "cart-1",
    payload: { cartId: "cart-1", stage: "secondReminder" },
    scheduledAt: "2026-09-05T20:00:00.000Z",
    createdAt: "2026-09-04T20:00:00.000Z",
    updatedAt: "2026-09-04T20:00:00.000Z",
    can: { retry: false, cancel: true },
  } as JobExecutionResource;

  const mount = async (execution: JobExecutionResource | null) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminJobsPayloadDialog execution={execution} onClose={() => {}} />
      </AlephaContext.Provider>,
    );
  };

  it("prints the payload whole, stage included, while an execution is set", async () => {
    await mount(parked);

    expect(screen.getByText("Payload")).toBeTruthy();
    expect(screen.getByText(/"stage": "secondReminder"/)).toBeTruthy();
    expect(screen.getByText(/"cartId": "cart-1"/)).toBeTruthy();
  });

  it("renders nothing when execution is null", async () => {
    await mount(null);

    expect(screen.queryByText("Payload")).toBeNull();
  });
});
