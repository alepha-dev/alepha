import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import type { JobRetention } from "alepha/api/jobs";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { afterEach, describe, expect, it } from "vitest";

import { useJobRetentionLabels } from "../useJobRetentionLabels.ts";

/**
 * The server sends `{}` for a rule with neither a count nor an age limit
 * (a `days` function answering zero or less reads as "no age limit"), and
 * that rule is printed as kept without a limit rather than "undefined days".
 */
describe("useJobRetentionLabels", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const sentence = async (retention: JobRetention): Promise<string> => {
    const Probe = () => (
      <div data-testid="sentence">
        {useJobRetentionLabels().sentence(retention)}
      </div>
    );
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <Probe />
      </AlephaContext.Provider>,
    );
    return screen.getByTestId("sentence").textContent ?? "";
  };

  it("prints a rule with no limit as kept with no limit", async () => {
    expect(
      await sentence({
        ok: {},
        error: { days: 30 },
        source: { ok: "job", error: "job" },
      }),
    ).toBe(
      "Successes: kept, no limit. Failures and cancellations: 30 days. Declared by the job.",
    );
  });
});
