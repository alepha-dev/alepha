import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, it } from "vitest";

import type { AutomationRunResource } from "../../../../../api/schemas/automationRunResourceSchema.ts";
import { I18n } from "../../../services/I18n.ts";
import AutomationRunEvidence from "./AutomationRunEvidence.tsx";

describe("Automation run evidence", () => {
  let alepha: Alepha;
  afterEach(async () => {
    cleanup();
    await alepha?.stop();
  });
  it("keeps queued intent distinct from delivery and links actions to live receipts", async ({
    expect,
  }) => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const run: AutomationRunResource = {
      id: crypto.randomUUID(),
      projectId: 1,
      automationId: crypto.randomUUID(),
      ruleRevision: 2,
      occurrenceId: "test",
      triggeredAt: "2026-10-16T00:00:00Z",
      createdAt: "2026-10-16T00:00:00Z",
      status: "partial",
      redacted: false,
      snapshot: {
        rule: null,
        ruleHash: "a".repeat(64),
        omitted: "Body omitted",
        inputs: { title: "Safe input" },
        selected: [{ title: "Matched input" }],
        variables: [],
        noData: true,
        counts: {
          selected: 50,
          matched: 2,
          executed: 1,
          deliveries: 1,
          skipped: 48,
          total: 51,
          totalIsExact: false,
          truncated: true,
          hasMore: true,
        },
        actions: [
          { index: 0, status: "queued", result: { enqueued: true } },
          {
            index: 1,
            status: "unknown",
            result: { reason: "Interrupted external effect" },
          },
          { index: 2, status: "refused", result: {} },
          { index: 3, status: "skipped", result: {} },
        ],
      },
      notifications: [
        {
          index: 0,
          outboxId: first,
          status: "delivered",
          receiptId: crypto.randomUUID(),
        },
        {
          index: 1,
          outboxId: second,
          status: "queued",
          lastAttempt: "deferred",
        },
      ],
    };
    render(
      <AlephaContext.Provider value={alepha}>
        <AutomationRunEvidence run={run} />
      </AlephaContext.Provider>,
    );
    expect(screen.getByText(/Queued, awaiting delivery/)).toBeTruthy();
    expect(screen.getByText(/Unknown, review required/)).toBeTruthy();
    expect(screen.getByText(/Action 3: Refused/)).toBeTruthy();
    expect(screen.getByText(/Action 4: Skipped/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Delivery receipt: Delivered" })
        .getAttribute("href"),
    ).toBe(`#delivery-${first}`);
    expect(
      screen
        .getByRole("link", { name: "Delivery receipt: Queued" })
        .getAttribute("href"),
    ).toBe(`#delivery-${second}`);
    expect(screen.getByText(/Last attempt: Deferred/)).toBeTruthy();
    expect(
      screen.getByText(/Email sent means transport acceptance/),
    ).toBeTruthy();
    expect(screen.getByText(/Body omitted/)).toBeTruthy();
    cleanup();
    render(
      <AlephaContext.Provider value={alepha}>
        <AutomationRunEvidence
          run={{ ...run, snapshot: null, notifications: [], redacted: true }}
        />
      </AlephaContext.Provider>,
    );
    expect(screen.queryByText(/Safe input/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
